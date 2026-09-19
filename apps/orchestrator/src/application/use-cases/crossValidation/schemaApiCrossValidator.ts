import { randomUUID } from 'node:crypto';
import {
  createFindingId,
  createCandidateFinding,
  type CandidateFinding,
  type RequirementsBaseline
} from '@solutions-studio/domain';

export interface SqlColumnDefinition {
  readonly name: string;
  readonly type: string;
  readonly isPrimaryKey: boolean;
  readonly isNotNull: boolean;
  readonly hasDefault: boolean;
}

export interface SqlTableDefinition {
  readonly name: string;
  readonly columns: readonly SqlColumnDefinition[];
  readonly primaryKeyColumns: readonly string[];
}

export interface CrossValidationInput {
  readonly openApiDoc: Record<string, unknown>;
  readonly sqlSchemaContent: string;
  readonly baseline: RequirementsBaseline;
  readonly openApiProjectionId: string;
  readonly sqlSchemaProjectionId: string;
}

export function normalizeName(name: string): string {
  const clean = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (clean.endsWith('ies')) {
    return clean.slice(0, -3) + 'y';
  }
  if (clean.endsWith('es') && !clean.endsWith('ses')) {
    return clean.slice(0, -2);
  }
  if (clean.endsWith('s') && !clean.endsWith('ss')) {
    return clean.slice(0, -1);
  }
  return clean;
}

export function parseSqlTables(sql: string): SqlTableDefinition[] {
  const tables: SqlTableDefinition[] = [];
  // Match CREATE TABLE [IF NOT EXISTS] name (...)
  const tableRegex =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_."]+)\s*\(([\s\S]*?)\);/gi;

  let match: RegExpExecArray | null;
  while ((match = tableRegex.exec(sql)) !== null) {
    const rawTableName = match[1].replace(/["']/g, '').split('.').pop() ?? match[1];
    const body = match[2];

    const columns: SqlColumnDefinition[] = [];
    const pkColumns: string[] = [];

    // Split body by commas that are not inside parentheses
    const lines: string[] = [];
    let currentLine = '';
    let parenDepth = 0;

    for (let i = 0; i < body.length; i++) {
      const char = body[i];
      if (char === '(') parenDepth++;
      else if (char === ')') parenDepth--;

      if (char === ',' && parenDepth === 0) {
        lines.push(currentLine.trim());
        currentLine = '';
      } else {
        currentLine += char;
      }
    }
    if (currentLine.trim()) {
      lines.push(currentLine.trim());
    }

    for (const rawLine of lines) {
      const line = rawLine.trim().replace(/\s+/g, ' ');
      if (!line || line.startsWith('--')) continue;

      // Table-level PRIMARY KEY constraint
      const tablePkMatch = line.match(/(?:CONSTRAINT\s+\w+\s+)?PRIMARY\s+KEY\s*\(([^)]+)\)/i);
      if (tablePkMatch) {
        const cols = tablePkMatch[1].split(',').map((c) => c.trim().replace(/["']/g, ''));
        pkColumns.push(...cols);
        continue;
      }

      // Skip other table-level constraints
      if (/^(?:CONSTRAINT|FOREIGN\s+KEY|UNIQUE|CHECK)\b/i.test(line)) {
        continue;
      }

      // Column definition: name type [constraints...]
      const colParts = line.split(' ');
      if (colParts.length < 2) continue;

      const colName = colParts[0].replace(/["']/g, '');
      const colType = colParts[1].toUpperCase();

      const isInlinePk = /PRIMARY\s+KEY/i.test(line);
      if (isInlinePk) {
        pkColumns.push(colName);
      }

      const isNotNull = isInlinePk || /NOT\s+NULL/i.test(line);
      const hasDefault =
        /DEFAULT/i.test(line) ||
        /SERIAL/i.test(colType) ||
        /GENERATED\s+ALWAYS\s+AS\s+IDENTITY/i.test(line) ||
        /gen_random_uuid/i.test(line);

      columns.push({
        name: colName,
        type: colType,
        isPrimaryKey: isInlinePk,
        isNotNull,
        hasDefault
      });
    }

    // Mark columns that were in table-level PK
    const finalColumns = columns.map((col) => ({
      ...col,
      isPrimaryKey: col.isPrimaryKey || pkColumns.includes(col.name)
    }));

    tables.push({
      name: rawTableName,
      columns: finalColumns,
      primaryKeyColumns: [...new Set(pkColumns)]
    });
  }

  return tables;
}

export class SchemaApiCrossValidator {
  validate(input: CrossValidationInput): CandidateFinding[] {
    const findings: CandidateFinding[] = [];
    const sqlTables = parseSqlTables(input.sqlSchemaContent);
    if (sqlTables.length === 0) {
      return findings;
    }

    const tableMap = new Map<string, SqlTableDefinition>();
    for (const table of sqlTables) {
      tableMap.set(normalizeName(table.name), table);
    }

    const openApiDoc = input.openApiDoc;
    const schemas = (openApiDoc.components as Record<string, unknown> | undefined)?.schemas as
      Record<string, unknown> | undefined;
    const paths = openApiDoc.paths as Record<string, unknown> | undefined;

    // Helper to create finding
    const addFinding = (
      type: 'data-boundary-ambiguity' | 'contradiction' | 'undefined-cardinality',
      rationale: string
    ) => {
      findings.push(
        createCandidateFinding({
          id: createFindingId(`FINDING-${randomUUID()}`),
          type,
          affectedRequirementRevisions: [...input.baseline.requirementRevisions],
          evidence: [],
          discoveredBy: 'artifact-validation',
          disposition: 'OPEN',
          rationale,
          baselineId: input.baseline.id,
          originatingProjectionId: input.openApiProjectionId
        })
      );
    };

    // 1. Entity & Schema Existence Check
    // Primary entity schemas in components.schemas
    const ignoredSchemaNames = new Set([
      'error',
      'problemdetails',
      'pagination',
      'paginationmeta',
      'apierror',
      'health',
      'healthstatus'
    ]);

    if (schemas) {
      for (const schemaName of Object.keys(schemas)) {
        const normSchema = normalizeName(schemaName);
        if (ignoredSchemaNames.has(normSchema)) continue;
        if (
          normSchema.endsWith('request') ||
          normSchema.endsWith('response') ||
          normSchema.endsWith('dto')
        ) {
          continue;
        }

        const matchingTable = tableMap.get(normSchema);
        if (!matchingTable) {
          addFinding(
            'data-boundary-ambiguity',
            `OpenAPI declares entity schema '${schemaName}', but no corresponding table '${schemaName.toLowerCase()}' exists in relational schema projection '${input.sqlSchemaProjectionId}'.`
          );
        }
      }
    }

    // Path roots check (e.g. /users, /accounts)
    if (paths) {
      for (const pathKey of Object.keys(paths)) {
        const segments = pathKey.split('/').filter((s) => s && !s.startsWith('{'));
        if (segments.length === 0) continue;
        const resourceName = segments[segments.length - 1]; // e.g. 'users' or 'accounts'
        const normResource = normalizeName(resourceName);
        if (
          ignoredSchemaNames.has(normResource) ||
          normResource === 'api' ||
          /^v\d+$/i.test(normResource)
        ) {
          continue;
        }

        const matchingTable = tableMap.get(normResource);
        if (!matchingTable) {
          // If we haven't already reported a finding for this entity schema
          const alreadyReported = findings.some((f) => f.rationale?.includes(`'${resourceName}'`));
          if (!alreadyReported) {
            addFinding(
              'data-boundary-ambiguity',
              `OpenAPI declares resource path '${pathKey}' (resource '${resourceName}'), but no corresponding table exists in relational schema projection '${input.sqlSchemaProjectionId}'.`
            );
          }
        }
      }
    }

    // 2. Identifier Type Contradiction Check
    // 3. Required Field Representability Check
    // 4. Cardinality & Type Conflict Check
    for (const [normTableName, table] of tableMap.entries()) {
      // Find matching OpenAPI entity schema or request schema
      let entitySchema: Record<string, unknown> | undefined;
      let createSchema: Record<string, unknown> | undefined;

      if (schemas) {
        for (const [sName, sVal] of Object.entries(schemas)) {
          if (!sVal || typeof sVal !== 'object') continue;
          const norm = normalizeName(sName);
          if (norm === normTableName) {
            entitySchema = sVal as Record<string, unknown>;
          } else if (
            norm === `create${normTableName}` ||
            norm === `${normTableName}create` ||
            norm === `new${normTableName}`
          ) {
            createSchema = sVal as Record<string, unknown>;
          }
        }
      }

      // Also inspect POST /resource requestBody schema if createSchema not found
      if (!createSchema && paths) {
        for (const [pKey, pVal] of Object.entries(paths)) {
          const segments = pKey.split('/').filter((s) => s && !s.startsWith('{'));
          const resourceName = segments[segments.length - 1];
          if (
            resourceName &&
            normalizeName(resourceName) === normTableName &&
            pVal &&
            typeof pVal === 'object'
          ) {
            const pathObj = pVal as Record<string, unknown>;
            const postOp = pathObj.post as Record<string, unknown> | undefined;
            if (postOp?.requestBody && typeof postOp.requestBody === 'object') {
              const rb = postOp.requestBody as Record<string, unknown>;
              const content = rb.content as Record<string, unknown> | undefined;
              const jsonContent = (
                content?.['application/json'] as Record<string, unknown> | undefined
              )?.schema;
              if (jsonContent && typeof jsonContent === 'object') {
                createSchema = jsonContent as Record<string, unknown>;
              }
            }
          }
        }
      }

      // Check Rule 2: Identifier Type Contradiction
      const targetSchema = entitySchema ?? createSchema;
      if (targetSchema && targetSchema.properties && typeof targetSchema.properties === 'object') {
        const props = targetSchema.properties as Record<string, unknown>;
        const pkCol = table.columns.find((c) => c.isPrimaryKey);

        if (pkCol) {
          // Look for 'id' or '<entity>Id' property
          const idProp = props.id ?? props[`${normTableName}Id`] ?? props[`${normTableName}_id`];
          if (idProp && typeof idProp === 'object') {
            const idObj = idProp as Record<string, unknown>;
            const openApiType = idObj.type;
            const openApiFormat = idObj.format;
            const isSqlUuid = pkCol.type.includes('UUID');
            const isSqlInt = /INT|SERIAL|BIGINT|SMALLINT/i.test(pkCol.type);

            if (openApiType === 'integer' && isSqlUuid) {
              addFinding(
                'contradiction',
                `Identifier type contradiction for entity '${table.name}': OpenAPI contract defines 'id' as type 'integer', but SQL schema defines primary key column '${pkCol.name}' as 'UUID'.`
              );
            } else if (openApiFormat === 'uuid' && isSqlInt) {
              addFinding(
                'contradiction',
                `Identifier type contradiction for entity '${table.name}': OpenAPI contract defines 'id' with format 'uuid', but SQL schema defines primary key column '${pkCol.name}' as '${pkCol.type}'.`
              );
            }
          }
        }
      }

      // Check Rule 3: Required Field Representability
      const reqCheckSchema = createSchema ?? entitySchema;
      if (reqCheckSchema) {
        const requiredFields = Array.isArray(reqCheckSchema.required)
          ? (reqCheckSchema.required as string[])
          : [];
        const tableColNormMap = new Map<string, SqlColumnDefinition>();
        for (const col of table.columns) {
          tableColNormMap.set(normalizeName(col.name), col);
        }

        // Required in API -> must exist in table
        for (const reqField of requiredFields) {
          const normField = normalizeName(reqField);
          // Skip surrogate id if table generates it
          if (normField === 'id' || normField === `${normTableName}id`) continue;

          if (!tableColNormMap.has(normField)) {
            addFinding(
              'data-boundary-ambiguity',
              `OpenAPI contract requires field '${reqField}', but column '${reqField}' does not exist in SQL table '${table.name}'.`
            );
          }
        }

        // Mandatory in table (NOT NULL without DEFAULT) -> must be representable in API
        for (const col of table.columns) {
          if (col.isNotNull && !col.hasDefault && !col.isPrimaryKey) {
            const normCol = normalizeName(col.name);
            const schemaProps =
              (reqCheckSchema.properties as Record<string, unknown> | undefined) ?? {};
            const schemaPropKeys = Object.keys(schemaProps).map(normalizeName);

            if (!schemaPropKeys.includes(normCol)) {
              addFinding(
                'data-boundary-ambiguity',
                `SQL table '${table.name}' defines mandatory column '${col.name}' (NOT NULL with no default), but field is missing from OpenAPI schema.`
              );
            }
          }
        }
      }

      // Check Rule 4: Cardinality & Obvious Type Conflicts
      if (entitySchema && entitySchema.properties && typeof entitySchema.properties === 'object') {
        const props = entitySchema.properties as Record<string, unknown>;
        for (const [propName, propVal] of Object.entries(props)) {
          if (!propVal || typeof propVal !== 'object') continue;
          const pObj = propVal as Record<string, unknown>;
          const normProp = normalizeName(propName);
          const col = table.columns.find((c) => normalizeName(c.name) === normProp);
          if (!col) continue;

          // Check array cardinality vs scalar column
          if (pObj.type === 'array') {
            const isScalar =
              /VARCHAR|TEXT|INT|INTEGER|BIGINT|BOOLEAN|NUMERIC|DATE|TIMESTAMP/i.test(col.type) &&
              !col.type.includes('[]');
            if (isScalar) {
              addFinding(
                'undefined-cardinality',
                `Cardinality conflict for '${propName}' on '${table.name}': OpenAPI defines field as 'array', but SQL schema defines scalar column '${col.name}' (${col.type}).`
              );
            }
          }

          // Check boolean vs numeric
          if (pObj.type === 'boolean' && /INT|NUMERIC|BIGINT|DECIMAL/i.test(col.type)) {
            addFinding(
              'contradiction',
              `Type contradiction for '${propName}' on '${table.name}': OpenAPI defines type 'boolean', but SQL column '${col.name}' has type '${col.type}'.`
            );
          } else if (
            (pObj.type === 'number' || pObj.type === 'integer') &&
            /BOOLEAN/i.test(col.type)
          ) {
            addFinding(
              'contradiction',
              `Type contradiction for '${propName}' on '${table.name}': OpenAPI defines type '${String(pObj.type)}', but SQL column '${col.name}' has type 'BOOLEAN'.`
            );
          }
        }
      }
    }

    return findings;
  }
}
