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

export interface SqlEnumDefinition {
  readonly name: string;
  readonly values: readonly string[];
}

export interface CrossValidationInput {
  readonly openApiDoc: Record<string, unknown>;
  readonly sqlSchemaContent: string;
  readonly baseline: RequirementsBaseline;
  readonly openApiProjectionId: string;
  readonly sqlSchemaProjectionId: string;
}

export function normalizeName(name: string): string {
  let clean = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (clean.endsWith('ies')) {
    return clean.slice(0, -3) + 'y';
  }
  if (clean.endsWith('sses') || clean.endsWith('statuses')) {
    clean = clean.slice(0, -2);
  } else if (clean.endsWith('es') && !clean.endsWith('ses')) {
    clean = clean.slice(0, -2);
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

export function parseSqlEnums(sql: string): SqlEnumDefinition[] {
  const enums: SqlEnumDefinition[] = [];
  const enumRegex =
    /CREATE\s+TYPE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_."]+)\s+AS\s+ENUM\s*\(([\s\S]*?)\);?/gi;

  let match: RegExpExecArray | null;
  while ((match = enumRegex.exec(sql)) !== null) {
    const rawEnumName = match[1].replace(/["']/g, '').split('.').pop() ?? match[1];
    const body = match[2];
    const cleanedBody = body.replace(/--.*$/gm, '');
    const values = cleanedBody
      .split(',')
      .map((val) => val.trim().replace(/^['"]|['"]$/g, ''))
      .filter((val) => val.length > 0);

    enums.push({
      name: rawEnumName,
      values
    });
  }

  return enums;
}

export function resolveSchemaRef(
  schemaOrRef: unknown,
  openApiDoc: Record<string, unknown>,
  visited: Set<string> = new Set<string>()
): Record<string, unknown> | undefined {
  if (!schemaOrRef || typeof schemaOrRef !== 'object') {
    return undefined;
  }

  const obj = schemaOrRef as Record<string, unknown>;
  const ref = obj.$ref;

  if (typeof ref !== 'string') {
    return obj;
  }

  if (visited.has(ref)) {
    return undefined;
  }
  visited.add(ref);

  if (ref.startsWith('#/')) {
    const parts = ref.slice(2).split('/');
    let current: unknown = openApiDoc;
    for (const part of parts) {
      if (!current || typeof current !== 'object') {
        current = undefined;
        break;
      }
      const decodedPart = part.replace(/~1/g, '/').replace(/~0/g, '~');
      current = (current as Record<string, unknown>)[decodedPart];
    }

    if (current && typeof current === 'object') {
      const targetResolved = resolveSchemaRef(current, openApiDoc, visited);
      if (targetResolved) {
        const restObj = { ...obj };
        delete restObj.$ref;
        return {
          ...targetResolved,
          ...restObj,
          properties: {
            ...((targetResolved.properties as Record<string, unknown>) ?? {}),
            ...((restObj.properties as Record<string, unknown>) ?? {})
          }
        };
      }
      return current as Record<string, unknown>;
    }
  }

  return obj;
}

export function extractProperties(
  schemaOrRef: unknown,
  openApiDoc: Record<string, unknown>,
  visited: Set<unknown> = new Set<unknown>()
): Record<string, unknown> {
  if (!schemaOrRef || typeof schemaOrRef !== 'object') {
    return {};
  }
  if (visited.has(schemaOrRef)) {
    return {};
  }
  visited.add(schemaOrRef);

  const resolved = resolveSchemaRef(schemaOrRef, openApiDoc);
  if (!resolved) {
    return {};
  }

  const props: Record<string, unknown> = {};

  if (resolved.properties && typeof resolved.properties === 'object') {
    Object.assign(props, resolved.properties);
  }

  if (Array.isArray(resolved.allOf)) {
    for (const subSchema of resolved.allOf) {
      const subProps = extractProperties(subSchema, openApiDoc, visited);
      Object.assign(props, subProps);
    }
  }

  return props;
}

export function extractRequired(
  schemaOrRef: unknown,
  openApiDoc: Record<string, unknown>,
  visited: Set<unknown> = new Set<unknown>()
): string[] {
  if (!schemaOrRef || typeof schemaOrRef !== 'object') {
    return [];
  }
  if (visited.has(schemaOrRef)) {
    return [];
  }
  visited.add(schemaOrRef);

  const resolved = resolveSchemaRef(schemaOrRef, openApiDoc);
  if (!resolved) {
    return [];
  }

  const requiredFields: string[] = [];

  if (Array.isArray(resolved.required)) {
    for (const f of resolved.required) {
      if (typeof f === 'string') {
        requiredFields.push(f);
      }
    }
  }

  if (Array.isArray(resolved.allOf)) {
    for (const subSchema of resolved.allOf) {
      const subReqs = extractRequired(subSchema, openApiDoc, visited);
      requiredFields.push(...subReqs);
    }
  }

  return [...new Set(requiredFields)];
}

const DEFAULT_SCHEMA_TABLE_ALIASES: Record<string, readonly string[]> = {
  lineitem: ['orderitem', 'orderitems', 'order_items', 'order_item'],
  lineitems: ['orderitem', 'orderitems', 'order_items', 'order_item'],
  orderitem: ['lineitem', 'lineitems', 'line_items', 'line_item'],
  orderitems: ['lineitem', 'lineitems', 'line_items', 'line_item']
};

export function resolveTableAlias(
  normSchema: string,
  tableMap: Map<string, SqlTableDefinition>,
  schemaVal?: unknown
): SqlTableDefinition | undefined {
  if (schemaVal && typeof schemaVal === 'object') {
    const sObj = schemaVal as Record<string, unknown>;
    const explicitMap = sObj['x-maps-to'] ?? sObj['x-table'] ?? sObj['x-table-name'];
    if (typeof explicitMap === 'string') {
      const match = tableMap.get(normalizeName(explicitMap));
      if (match) return match;
    }
    const description = sObj.description;
    if (typeof description === 'string') {
      const mapsToMatch = description.match(/@maps-to:\s*([a-zA-Z0-9_]+)/i);
      if (mapsToMatch) {
        const match = tableMap.get(normalizeName(mapsToMatch[1]));
        if (match) return match;
      }
    }
  }

  const aliases = DEFAULT_SCHEMA_TABLE_ALIASES[normSchema];
  if (aliases) {
    for (const alias of aliases) {
      const match = tableMap.get(normalizeName(alias));
      if (match) return match;
    }
  }

  if (normSchema.endsWith('item')) {
    const schemaPrefix = normSchema.slice(0, -4);
    if (schemaPrefix) {
      for (const [tNorm, table] of tableMap.entries()) {
        if (tNorm.endsWith('item') && tNorm !== 'item') {
          const parentNorm = tNorm.slice(0, -4);
          if (
            (parentNorm === schemaPrefix ||
              parentNorm.includes(schemaPrefix) ||
              schemaPrefix.includes(parentNorm)) &&
            tableMap.has(parentNorm)
          ) {
            return table;
          }
        }
      }
    }

    for (const [tNorm, table] of tableMap.entries()) {
      if (tNorm.endsWith('item') && tNorm !== 'item') {
        const parentNorm = tNorm.slice(0, -4);
        if (tableMap.has(parentNorm)) {
          return table;
        }
      }
    }
  }

  return undefined;
}

export function hasStateTransitionAnnotation(pathItem: unknown): boolean {
  if (!pathItem || typeof pathItem !== 'object') return false;
  const pObj = pathItem as Record<string, unknown>;

  const checkText = (text: unknown): boolean => {
    if (typeof text !== 'string') return false;
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (
        /@decision[:\s]/i.test(line) &&
        /\b(?:state[- ]transition|status[- ]transition|lifecycle[- ]transition|action[- ]resource|action[- ]endpoint)\b/i.test(
          line
        )
      ) {
        return true;
      }
    }
    return false;
  };

  if (checkText(pObj.description) || checkText(pObj.summary)) {
    return true;
  }

  for (const key of Object.keys(pObj)) {
    if (key.startsWith('x-') && checkText(pObj[key])) {
      return true;
    }
  }

  const operations = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];
  for (const op of operations) {
    const opVal = pObj[op];
    if (opVal && typeof opVal === 'object') {
      const opObj = opVal as Record<string, unknown>;
      if (checkText(opObj.description) || checkText(opObj.summary)) {
        return true;
      }
      for (const key of Object.keys(opObj)) {
        if (key.startsWith('x-') && checkText(opObj[key])) {
          return true;
        }
      }
    }
  }

  return false;
}

const RAW_IGNORED_SCHEMA_NAMES = [
  'error',
  'errors',
  'problemdetails',
  'problemdetail',
  'pagination',
  'paginationmeta',
  'apierror',
  'apierrors',
  'health',
  'healthstatus',
  'healthcheck'
] as const;

const RAW_ACTION_VERBS = [
  'pay',
  'cancel',
  'refund',
  'checkout',
  'ship',
  'deliver',
  'complete',
  'authorize',
  'capture',
  'void',
  'verify',
  'validate',
  'activate',
  'deactivate',
  'suspend',
  'resume',
  'submit',
  'approve',
  'reject',
  'reopen',
  'close',
  'archive',
  'retry',
  'reset',
  'publish',
  'unpublish',
  'lock',
  'unlock',
  'execute',
  'start',
  'stop',
  'pause',
  'transition',
  'status',
  'state',
  'process',
  'sync',
  'confirm'
] as const;

export class SchemaApiCrossValidator {
  validate(input: CrossValidationInput): CandidateFinding[] {
    const findings: CandidateFinding[] = [];
    const sqlTables = parseSqlTables(input.sqlSchemaContent);
    const sqlEnums = parseSqlEnums(input.sqlSchemaContent);
    if (sqlTables.length === 0 && sqlEnums.length === 0) {
      return findings;
    }

    const tableMap = new Map<string, SqlTableDefinition>();
    for (const table of sqlTables) {
      tableMap.set(normalizeName(table.name), table);
    }

    const enumMap = new Map<string, SqlEnumDefinition>();
    for (const sqlEnum of sqlEnums) {
      enumMap.set(normalizeName(sqlEnum.name), sqlEnum);
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

    const ignoredSchemaNames = new Set([
      ...RAW_IGNORED_SCHEMA_NAMES,
      ...RAW_IGNORED_SCHEMA_NAMES.map(normalizeName)
    ]);
    const actionVerbs = new Set([...RAW_ACTION_VERBS, ...RAW_ACTION_VERBS.map(normalizeName)]);

    // 1. Entity & Schema Existence Check
    // Primary entity schemas in components.schemas
    if (schemas) {
      for (const schemaName of Object.keys(schemas)) {
        const normSchema = normalizeName(schemaName);
        if (
          ignoredSchemaNames.has(normSchema) ||
          ignoredSchemaNames.has(schemaName.toLowerCase())
        ) {
          continue;
        }
        if (
          normSchema.endsWith('request') ||
          normSchema.endsWith('response') ||
          normSchema.endsWith('dto')
        ) {
          continue;
        }

        const matchingTable =
          tableMap.get(normSchema) ?? resolveTableAlias(normSchema, tableMap, schemas[schemaName]);
        const matchingEnum = enumMap.get(normSchema);
        if (!matchingTable && !matchingEnum) {
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
        const allSegments = pathKey.split('/').filter(Boolean);
        const nonParamSegments = allSegments.filter((s) => !s.startsWith('{'));
        const meaningfulSegments = nonParamSegments.filter(
          (s) => s.toLowerCase() !== 'api' && !/^v\d+$/i.test(s)
        );
        if (meaningfulSegments.length === 0) continue;

        const rootResource = meaningfulSegments[0];
        const normRoot = normalizeName(rootResource);
        if (
          ignoredSchemaNames.has(normRoot) ||
          ignoredSchemaNames.has(rootResource.toLowerCase())
        ) {
          continue;
        }

        const rootTable = tableMap.get(normRoot) ?? resolveTableAlias(normRoot, tableMap);
        const rootEnum = enumMap.get(normRoot);
        if (!rootTable && !rootEnum) {
          // If we haven't already reported a finding for this entity schema
          const alreadyReported = findings.some((f) => f.rationale?.includes(`'${rootResource}'`));
          if (!alreadyReported) {
            addFinding(
              'data-boundary-ambiguity',
              `OpenAPI declares resource path '${pathKey}' (resource '${rootResource}'), but no corresponding table exists in relational schema projection '${input.sqlSchemaProjectionId}'.`
            );
          }
          continue;
        }

        if (meaningfulSegments.length > 1) {
          const terminal = meaningfulSegments[meaningfulSegments.length - 1];
          const normTerminal = normalizeName(terminal);

          if (
            normTerminal === normRoot ||
            ignoredSchemaNames.has(normTerminal) ||
            ignoredSchemaNames.has(terminal.toLowerCase())
          ) {
            continue;
          }

          const isActionVerb =
            actionVerbs.has(normTerminal) || actionVerbs.has(terminal.toLowerCase());
          const pathItem = paths[pathKey];
          const hasDecisionAnnotation = hasStateTransitionAnnotation(pathItem);

          const matchesDirectTable =
            tableMap.has(normTerminal) || Boolean(resolveTableAlias(normTerminal, tableMap));
          const matchesCompositeTable =
            tableMap.has(normalizeName(`${rootResource}_${terminal}`)) ||
            tableMap.has(normalizeName(`${normRoot}_${normTerminal}`)) ||
            Boolean(resolveTableAlias(normalizeName(`${rootResource}_${terminal}`), tableMap));
          const matchesEnumValue = Boolean(
            rootEnum?.values.some((v) => normalizeName(v) === normTerminal)
          );

          if (
            isActionVerb ||
            hasDecisionAnnotation ||
            matchesDirectTable ||
            matchesCompositeTable ||
            matchesEnumValue
          ) {
            continue;
          }

          const alreadyReported = findings.some((f) => f.rationale?.includes(`'${terminal}'`));
          if (!alreadyReported) {
            addFinding(
              'data-boundary-ambiguity',
              `OpenAPI declares resource path '${pathKey}' (resource '${terminal}'), but no corresponding table exists in relational schema projection '${input.sqlSchemaProjectionId}'.`
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
            entitySchema = resolveSchemaRef(sVal, openApiDoc);
          } else if (
            norm === `create${normTableName}` ||
            norm === `${normTableName}create` ||
            norm === `new${normTableName}` ||
            norm === `create${normTableName}request` ||
            norm === `${normTableName}createrequest` ||
            norm === `new${normTableName}request`
          ) {
            createSchema = resolveSchemaRef(sVal, openApiDoc);
          }
        }
      }

      // Also inspect collection POST /resource requestBody schema if createSchema not found
      if (!createSchema && paths) {
        for (const [pKey, pVal] of Object.entries(paths)) {
          const allSegments = pKey.split('/').filter(Boolean);
          // Only select from a collection-level POST: no path parameters (e.g. {id})
          const hasPathParam = allSegments.some((s) => s.startsWith('{'));
          if (hasPathParam) continue;

          const nonParamSegments = allSegments.filter((s) => !s.startsWith('{'));
          const meaningful = nonParamSegments.filter(
            (s) => s.toLowerCase() !== 'api' && !/^v\d+$/i.test(s)
          );
          // Collection endpoint must have exactly one meaningful segment naming the resource
          if (meaningful.length !== 1) continue;

          const resourceName = meaningful[0];
          const normResource = normalizeName(resourceName);
          const isMatch =
            normResource === normTableName ||
            Boolean(resolveTableAlias(normResource, tableMap)?.name === table.name);

          if (isMatch && pVal && typeof pVal === 'object') {
            const pathObj = pVal as Record<string, unknown>;
            const postOp = pathObj.post as Record<string, unknown> | undefined;
            if (postOp?.requestBody && typeof postOp.requestBody === 'object') {
              const rb = postOp.requestBody as Record<string, unknown>;
              const resolvedRb = resolveSchemaRef(rb, openApiDoc) ?? rb;
              const content = resolvedRb.content as Record<string, unknown> | undefined;
              const jsonContent = (
                content?.['application/json'] as Record<string, unknown> | undefined
              )?.schema;
              if (jsonContent && typeof jsonContent === 'object') {
                createSchema = resolveSchemaRef(jsonContent, openApiDoc);
                if (createSchema) {
                  // Stop scanning after the intended collection create operation is selected
                  break;
                }
              }
            }
          }
        }
      }

      // Check Rule 2: Identifier Type Contradiction
      const targetSchema = entitySchema ?? createSchema;
      if (targetSchema) {
        const props = extractProperties(targetSchema, openApiDoc);
        const pkCol = table.columns.find((c) => c.isPrimaryKey);

        if (pkCol && Object.keys(props).length > 0) {
          // Look for 'id' or '<entity>Id' property
          const idProp = props.id ?? props[`${normTableName}Id`] ?? props[`${normTableName}_id`];
          if (idProp && typeof idProp === 'object') {
            const idObj =
              resolveSchemaRef(idProp, openApiDoc) ?? (idProp as Record<string, unknown>);
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
        const requiredFields = extractRequired(reqCheckSchema, openApiDoc);
        const schemaProps = extractProperties(reqCheckSchema, openApiDoc);
        const schemaPropKeys = Object.keys(schemaProps).map(normalizeName);
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
      if (entitySchema) {
        const props = extractProperties(entitySchema, openApiDoc);
        for (const [propName, propVal] of Object.entries(props)) {
          if (!propVal || typeof propVal !== 'object') continue;
          const pObj =
            resolveSchemaRef(propVal, openApiDoc) ?? (propVal as Record<string, unknown>);
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
