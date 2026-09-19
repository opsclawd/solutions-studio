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
  readonly checkValues?: readonly string[];
  readonly referencesTable?: string;
  readonly referencesColumn?: string;
}

export interface SqlForeignKeyDefinition {
  readonly column: string;
  readonly referencedTable: string;
  readonly referencedColumn?: string;
}

export interface SqlTableDefinition {
  readonly name: string;
  readonly columns: readonly SqlColumnDefinition[];
  readonly primaryKeyColumns: readonly string[];
  readonly foreignKeys?: readonly SqlForeignKeyDefinition[];
}

export interface SqlEnumDefinition {
  readonly name: string;
  readonly values: readonly string[];
  readonly isSynthetic?: boolean;
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

const TABLE_CHECK_REGEX =
  /(?:CONSTRAINT\s+(?<constraintName>[a-zA-Z0-9_]+)\s+)?CHECK\s*\(\s*\(?(?:[a-zA-Z0-9_."]+\.)?(?<colName>[a-zA-Z0-9_"]+)\s+IN\s*\((?<rawVals>[\s\S]*?)\)\s*\)?\s*\)/i;

const TABLE_FK_REGEX =
  /(?:CONSTRAINT\s+[a-zA-Z0-9_]+\s+)?FOREIGN\s+KEY\s*\((?<fkCols>[^)]+)\)\s*REFERENCES\s+(?<refTable>[a-zA-Z0-9_."]+)(?:\s*\((?<refCols>[^)]+)\))?/i;

const INLINE_CHECK_REGEX =
  /CHECK\s*\(\s*\(?(?:(?:[a-zA-Z0-9_."]+\.)?[a-zA-Z0-9_"]+\s+IN|VALUE\s+IN|IN)\s*\((?<rawVals>[\s\S]*?)\)\s*\)?\s*\)/i;

const INLINE_FK_REGEX = /REFERENCES\s+(?<refTable>[a-zA-Z0-9_."]+)(?:\s*\((?<refCol>[^)]+)\))?/i;

export function stripSqlComments(sql: string): string {
  let result = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = i + 1 < sql.length ? sql[i + 1] : '';

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        result += '\n';
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inSingleQuote) {
      result += char;
      if (char === "'") {
        if (nextChar === "'") {
          result += nextChar;
          i++;
        } else {
          inSingleQuote = false;
        }
      }
      continue;
    }

    if (inDoubleQuote) {
      result += char;
      if (char === '"') {
        if (nextChar === '"') {
          result += nextChar;
          i++;
        } else {
          inDoubleQuote = false;
        }
      }
      continue;
    }

    if (char === '-' && nextChar === '-') {
      inLineComment = true;
      i++;
      continue;
    }

    if (char === '/' && nextChar === '*') {
      inBlockComment = true;
      i++;
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      result += char;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      result += char;
      continue;
    }

    result += char;
  }

  return result;
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
    const cleanBody = stripSqlComments(body);

    const columns: SqlColumnDefinition[] = [];
    const pkColumns: string[] = [];
    const foreignKeys: SqlForeignKeyDefinition[] = [];

    // Split cleanBody by commas that are not inside parentheses
    const lines: string[] = [];
    let currentLine = '';
    let parenDepth = 0;

    for (let i = 0; i < cleanBody.length; i++) {
      const char = cleanBody[i];
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

    const tableCheckMap = new Map<string, string[]>();
    const tableFkMap = new Map<string, { table: string; col?: string }>();

    // Pass 1: Extract table-level constraints
    for (const rawLine of lines) {
      const line = rawLine.replace(/\s+/g, ' ').trim();
      if (!line) continue;

      // Table-level PRIMARY KEY constraint
      const tablePkMatch = line.match(/(?:CONSTRAINT\s+\w+\s+)?PRIMARY\s+KEY\s*\(([^)]+)\)/i);
      if (tablePkMatch) {
        const cols = tablePkMatch[1].split(',').map((c) => c.trim().replace(/["']/g, ''));
        pkColumns.push(...cols);
        continue;
      }

      // Table-level CHECK constraint
      const tableCheckMatch = line.match(TABLE_CHECK_REGEX);
      if (tableCheckMatch?.groups?.colName && tableCheckMatch?.groups?.rawVals) {
        const colName = tableCheckMatch.groups.colName.replace(/["']/g, '');
        const vals = tableCheckMatch.groups.rawVals
          .split(',')
          .map((v) =>
            v
              .trim()
              .replace(/^['"]|['"]$/g, '')
              .trim()
          )
          .filter((v) => v.length > 0);
        tableCheckMap.set(colName.toLowerCase(), vals);
        continue;
      }

      // Table-level FOREIGN KEY constraint
      const tableFkMatch = line.match(TABLE_FK_REGEX);
      if (tableFkMatch?.groups?.fkCols && tableFkMatch?.groups?.refTable) {
        const fkCols = tableFkMatch.groups.fkCols
          .split(',')
          .map((c) => c.trim().replace(/["']/g, ''));
        const rawRefTable =
          tableFkMatch.groups.refTable.replace(/["']/g, '').split('.').pop() ??
          tableFkMatch.groups.refTable;
        const refCols = tableFkMatch.groups.refCols
          ? tableFkMatch.groups.refCols.split(',').map((c) => c.trim().replace(/["']/g, ''))
          : [];
        fkCols.forEach((col, idx) => {
          tableFkMap.set(col.toLowerCase(), { table: rawRefTable, col: refCols[idx] });
          foreignKeys.push({
            column: col,
            referencedTable: rawRefTable,
            referencedColumn: refCols[idx]
          });
        });
        continue;
      }
    }

    // Pass 2: Extract column definitions and inline constraints
    for (const rawLine of lines) {
      const line = rawLine.replace(/\s+/g, ' ').trim();
      if (!line) continue;

      // Skip table-level constraints
      if (/^(?:CONSTRAINT|PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK)\b/i.test(line)) {
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

      // Inline CHECK
      let inlineCheckVals: string[] | undefined;
      const inlineCheckMatch = line.match(INLINE_CHECK_REGEX);
      if (inlineCheckMatch?.groups?.rawVals) {
        inlineCheckVals = inlineCheckMatch.groups.rawVals
          .split(',')
          .map((v) =>
            v
              .trim()
              .replace(/^['"]|['"]$/g, '')
              .trim()
          )
          .filter((v) => v.length > 0);
      }

      // Inline REFERENCES
      let inlineFkInfo: { table: string; col?: string } | undefined;
      const inlineFkMatch = line.match(INLINE_FK_REGEX);
      if (inlineFkMatch?.groups?.refTable) {
        const rawRefTable =
          inlineFkMatch.groups.refTable.replace(/["']/g, '').split('.').pop() ??
          inlineFkMatch.groups.refTable;
        const refCol = inlineFkMatch.groups.refCol
          ? inlineFkMatch.groups.refCol.replace(/["']/g, '').trim()
          : undefined;
        inlineFkInfo = { table: rawRefTable, col: refCol };
        foreignKeys.push({
          column: colName,
          referencedTable: rawRefTable,
          referencedColumn: refCol
        });
      }

      const checkValues = inlineCheckVals ?? tableCheckMap.get(colName.toLowerCase());
      const fkInfo = inlineFkInfo ?? tableFkMap.get(colName.toLowerCase());

      columns.push({
        name: colName,
        type: colType,
        isPrimaryKey: isInlinePk,
        isNotNull,
        hasDefault,
        checkValues,
        referencesTable: fkInfo?.table,
        referencesColumn: fkInfo?.col
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
      primaryKeyColumns: [...new Set(pkColumns)],
      foreignKeys: foreignKeys.length > 0 ? foreignKeys : undefined
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
    const cleanedBody = stripSqlComments(body);
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

    if (!schemaPrefix || !tableMap.has(schemaPrefix)) {
      for (const [tNorm, table] of tableMap.entries()) {
        if (tNorm.endsWith('item') && tNorm !== 'item') {
          const parentNorm = tNorm.slice(0, -4);
          if (tableMap.has(parentNorm)) {
            return table;
          }
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

export function isEnumSchema(schemaOrRef: unknown, openApiDoc: Record<string, unknown>): boolean {
  if (!schemaOrRef || typeof schemaOrRef !== 'object') return false;
  const resolved = resolveSchemaRef(schemaOrRef, openApiDoc);
  if (!resolved || typeof resolved !== 'object') return false;

  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    return true;
  }
  if (Array.isArray(resolved.allOf)) {
    for (const sub of resolved.allOf) {
      if (isEnumSchema(sub, openApiDoc)) return true;
    }
  }
  return false;
}

export function getEnumValues(
  schemaOrRef: unknown,
  openApiDoc: Record<string, unknown>
): string[] | undefined {
  if (!schemaOrRef || typeof schemaOrRef !== 'object') return undefined;
  const resolved = resolveSchemaRef(schemaOrRef, openApiDoc);
  if (!resolved || typeof resolved !== 'object') return undefined;

  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    return resolved.enum.map((v) => String(v));
  }
  if (Array.isArray(resolved.allOf)) {
    for (const sub of resolved.allOf) {
      const vals = getEnumValues(sub, openApiDoc);
      if (vals && vals.length > 0) return vals;
    }
  }
  return undefined;
}

export function matchesCheckConstraintEnum(
  normSchema: string,
  schemaVal: unknown,
  sqlTables: readonly SqlTableDefinition[],
  openApiDoc: Record<string, unknown>
): boolean {
  const enumVals = getEnumValues(schemaVal, openApiDoc);
  if (!enumVals || enumVals.length === 0) {
    return false;
  }

  const schemaEnumSet = new Set(enumVals.map((v) => v.toUpperCase().trim()));

  for (const table of sqlTables) {
    const normTable = normalizeName(table.name);
    for (const col of table.columns) {
      if (!col.checkValues || col.checkValues.length === 0) continue;
      // String-compatible column
      if (!/VARCHAR|TEXT|CHAR|STRING/i.test(col.type)) continue;

      const normCol = normalizeName(col.name);
      const colCheckSet = new Set(col.checkValues.map((v) => v.toUpperCase().trim()));

      let overlapCount = 0;
      for (const val of schemaEnumSet) {
        if (colCheckSet.has(val)) {
          overlapCount++;
        }
      }

      if (overlapCount === 0) continue;

      const isSubset = overlapCount === schemaEnumSet.size;
      const isSuperset = overlapCount === colCheckSet.size;

      if (!isSubset && !isSuperset) continue;

      // Naming affinity
      const normComposite = normalizeName(`${table.name}_${col.name}`);
      const normComposite2 = normalizeName(`${normTable}_${col.name}`);
      const hasNamingAffinity =
        normSchema === normCol ||
        normSchema === normComposite ||
        normSchema === normComposite2 ||
        normSchema.includes(normCol) ||
        normCol.includes(normSchema);

      if (hasNamingAffinity || overlapCount >= 2) {
        return true;
      }
    }
  }

  return false;
}

export function hasForeignKeyToParent(
  childTable: SqlTableDefinition,
  parentTable: SqlTableDefinition
): boolean {
  const normParent = normalizeName(parentTable.name);
  return childTable.columns.some((c) => {
    if (c.referencesTable && normalizeName(c.referencesTable) === normParent) {
      return true;
    }
    const normCol = normalizeName(c.name);
    return normCol === `${normParent}id` || normCol === 'parentid';
  });
}

export function isChildTableOf(
  childTable: SqlTableDefinition,
  parentTable: SqlTableDefinition,
  tableMap: Map<string, SqlTableDefinition>,
  openApiDoc?: Record<string, unknown>
): boolean {
  const normChild = normalizeName(childTable.name);
  const normParent = normalizeName(parentTable.name);
  if (normChild === normParent) return false;

  // Check 1: Naming convention prefix + child suffix
  const childSuffixes = ['item', 'line', 'detail', 'entry', 'row', 'element', 'part', 'component'];
  const hasParentPrefix = normChild.startsWith(normParent);
  const hasChildSuffix = childSuffixes.some((s) => normChild.endsWith(s));
  if (hasParentPrefix && hasChildSuffix) {
    return true;
  }

  // Check 2: Incoming array relationship in OpenAPI parent schema
  if (openApiDoc && openApiDoc.components && typeof openApiDoc.components === 'object') {
    const schemas = (openApiDoc.components as Record<string, unknown>).schemas as
      Record<string, unknown> | undefined;
    if (schemas) {
      for (const [sName, sVal] of Object.entries(schemas)) {
        const normS = normalizeName(sName);
        if (
          normS === normParent ||
          normS === `create${normParent}` ||
          normS === `${normParent}create` ||
          normS === `new${normParent}` ||
          normS === `${normParent}createrequest` ||
          normS === `create${normParent}request`
        ) {
          const props = extractProperties(sVal as Record<string, unknown>, openApiDoc);
          for (const pVal of Object.values(props)) {
            const resolvedP =
              resolveSchemaRef(pVal, openApiDoc) ?? (pVal as Record<string, unknown>);
            if (
              resolvedP &&
              resolvedP.type === 'array' &&
              resolvedP.items &&
              typeof resolvedP.items === 'object'
            ) {
              const itemObj = resolvedP.items as Record<string, unknown>;
              const refTarget =
                typeof itemObj.$ref === 'string'
                  ? itemObj.$ref.split('/').pop()
                  : typeof itemObj.title === 'string'
                    ? itemObj.title
                    : undefined;
              if (refTarget) {
                const normRef = normalizeName(refTarget);
                if (
                  normRef === normChild ||
                  normChild.startsWith(normRef) ||
                  normRef.startsWith(normChild)
                ) {
                  return true;
                }
              }
            }
          }
        }
      }
    }
  }

  // Check 3: Suffix alias resolution through resolveTableAlias (Resolves AC-12)
  const resolvedChild = resolveTableAlias(normChild, tableMap);
  if (resolvedChild && resolvedChild.name === childTable.name) {
    const childPrefix = normChild.endsWith('item') ? normChild.slice(0, -4) : normChild;
    if (
      childPrefix &&
      (childPrefix === normParent ||
        childPrefix.startsWith(normParent) ||
        normParent.startsWith(childPrefix))
    ) {
      return true;
    }
  }
  const resolvedParentChild = resolveTableAlias(`${normParent}item`, tableMap);
  if (resolvedParentChild && resolvedParentChild.name === childTable.name) {
    return true;
  }

  return false;
}

export function isParentForeignKey(
  col: SqlColumnDefinition,
  table: SqlTableDefinition,
  tableMap: Map<string, SqlTableDefinition>,
  openApiDoc?: Record<string, unknown>
): boolean {
  const normCol = normalizeName(col.name);

  // Case A: Explicit REFERENCES constraint
  if (col.referencesTable) {
    const normRefTable = normalizeName(col.referencesTable);
    const parentTable = tableMap.get(normRefTable) ?? resolveTableAlias(normRefTable, tableMap);
    if (!parentTable) return false;

    // Strict parentage requirement: table MUST be a verified child of parentTable
    const isChild = isChildTableOf(table, parentTable, tableMap, openApiDoc);
    if (!isChild) {
      // Non-parent foreign key! e.g. product_id REFERENCES products(id) on order_items.
      return false;
    }

    // Must be the parent's lineage key (local column name must match parent lineage form)
    const matchesLocalParentId = normCol === `${normRefTable}id` || normCol === 'parentid';

    if (!matchesLocalParentId) {
      return false;
    }

    // If referencesColumn is specified, it should refer to the parent's primary key
    if (
      col.referencesColumn &&
      normalizeName(col.referencesColumn) !== 'id' &&
      normalizeName(col.referencesColumn) !== `${normRefTable}id`
    ) {
      return false;
    }

    return true;
  }

  // Case B: Inferred FK via naming convention on verified child table
  for (const [normParent, parentTable] of tableMap.entries()) {
    if (isChildTableOf(table, parentTable, tableMap, openApiDoc)) {
      if (normCol === `${normParent}id` || normCol === 'parentid') {
        return true;
      }
    }
  }

  return false;
}

export function hasBackingChildTable(
  propName: string,
  propSchema: Record<string, unknown>,
  parentTable: SqlTableDefinition,
  tableMap: Map<string, SqlTableDefinition>,
  openApiDoc: Record<string, unknown>
): boolean {
  const normParent = normalizeName(parentTable.name);
  const normProp = normalizeName(propName);

  // Strategy 1: Target schema name from array items ($ref or title)
  let targetSchemaName: string | undefined;
  if (propSchema.items && typeof propSchema.items === 'object') {
    const itemsObj = propSchema.items as Record<string, unknown>;
    if (typeof itemsObj.$ref === 'string') {
      targetSchemaName = itemsObj.$ref.split('/').pop();
    } else if (typeof itemsObj.title === 'string') {
      targetSchemaName = itemsObj.title;
    }
  }

  const candidateNames: string[] = [];
  if (targetSchemaName) {
    const stripped = targetSchemaName.replace(
      /(?:Create|Update|New)?(?:Request|Response|Dto|Input)$/i,
      ''
    );
    candidateNames.push(stripped);
    candidateNames.push(targetSchemaName);
  }

  // Strategy 2: Singularized parent prefix combined with property name
  candidateNames.push(`${normParent}_${normProp}`);
  candidateNames.push(`${normParent}_${propName}`);
  candidateNames.push(propName);
  candidateNames.push(normProp);

  // Strategy 3: Check candidate names in tableMap and verify BOTH parent-child relationship AND foreign key link
  for (const candidate of candidateNames) {
    const normCandidate = normalizeName(candidate);
    const candidateTable =
      tableMap.get(normCandidate) ?? resolveTableAlias(normCandidate, tableMap);
    if (candidateTable && candidateTable.name !== parentTable.name) {
      if (
        hasForeignKeyToParent(candidateTable, parentTable) &&
        isChildTableOf(candidateTable, parentTable, tableMap, openApiDoc)
      ) {
        return true;
      }
    }
  }

  // Strategy 4: Foreign key scan across tableMap for tables referencing parentTable
  for (const candidateTable of tableMap.values()) {
    if (candidateTable.name === parentTable.name) continue;
    const hasFkToParent = hasForeignKeyToParent(candidateTable, parentTable);
    if (hasFkToParent) {
      const normChild = normalizeName(candidateTable.name);
      const matchesProperty =
        normChild.includes(normProp) ||
        normProp.includes(normChild) ||
        (DEFAULT_SCHEMA_TABLE_ALIASES[normProp]?.some(
          (alias) => normalizeName(alias) === normChild
        ) ??
          false);
      const matchesTarget =
        targetSchemaName !== undefined &&
        (normChild.includes(normalizeName(targetSchemaName)) ||
          normalizeName(targetSchemaName).includes(normChild) ||
          (DEFAULT_SCHEMA_TABLE_ALIASES[normalizeName(targetSchemaName)]?.some(
            (alias) => normalizeName(alias) === normChild
          ) ??
            false));

      if (matchesProperty || matchesTarget) {
        return true;
      }
    }
  }

  return false;
}

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

    // Upfront synthetic enum population from VARCHAR + CHECK constraints
    for (const table of sqlTables) {
      const normTable = normalizeName(table.name);
      for (const col of table.columns) {
        if (col.checkValues && col.checkValues.length > 0) {
          const syntheticEnum: SqlEnumDefinition = {
            name: `${table.name}_${col.name}`,
            values: col.checkValues,
            isSynthetic: true
          };
          // Register under composite names and column name
          enumMap.set(normalizeName(`${table.name}_${col.name}`), syntheticEnum);
          enumMap.set(normalizeName(`${normTable}_${col.name}`), syntheticEnum);
          enumMap.set(normalizeName(`${normTable}${col.name}`), syntheticEnum);
          if (!enumMap.has(normalizeName(col.name))) {
            enumMap.set(normalizeName(col.name), syntheticEnum);
          }
        }
      }
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
        const isNativeEnumMatch = Boolean(matchingEnum && !matchingEnum.isSynthetic);
        let isCheckEnumMatch = false;

        if (!matchingTable && !isNativeEnumMatch) {
          isCheckEnumMatch = matchesCheckConstraintEnum(
            normSchema,
            schemas[schemaName],
            sqlTables,
            openApiDoc
          );
        }

        if (!matchingTable && !isNativeEnumMatch && !isCheckEnumMatch) {
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
            const propDef = schemaProps[reqField];
            if (propDef && typeof propDef === 'object') {
              const resolvedProp =
                resolveSchemaRef(propDef, openApiDoc) ?? (propDef as Record<string, unknown>);
              if (resolvedProp.type === 'array') {
                if (hasBackingChildTable(reqField, resolvedProp, table, tableMap, openApiDoc)) {
                  continue;
                }
              }
            }

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

            if (isParentForeignKey(col, table, tableMap, openApiDoc)) {
              continue;
            }

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
