import YAML from 'yaml';
import type {
  IOpenApiValidatorGateway,
  OpenApiValidationResult,
  OpenApiValidationErrorDetails
} from '../../application/ports/validation/IOpenApiValidatorGateway.js';

const VALID_HTTP_METHODS = new Set([
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace'
]);
const VALID_PRIMITIVE_TYPES = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object',
  'null'
]);
const VALID_PARAMETER_LOCATIONS = new Set(['query', 'header', 'path', 'cookie']);

export class OpenApiStructuralValidatorAdapter implements IOpenApiValidatorGateway {
  async validate(openApiContent: string): Promise<OpenApiValidationResult> {
    const trimmed = openApiContent.trim();
    if (!trimmed) {
      return {
        isValid: false,
        errorMessage: 'OpenAPI document cannot be empty.',
        errorDetails: [
          {
            message: 'OpenAPI document cannot be empty.',
            rule: 'empty-document'
          }
        ]
      };
    }

    const errors: OpenApiValidationErrorDetails[] = [];

    // 1. Syntax and Parser Validation
    let doc: YAML.Document;
    try {
      doc = YAML.parseDocument(trimmed, { uniqueKeys: true });
    } catch (err: unknown) {
      const error = err as { message?: string; linePos?: { line: number; col: number }[] };
      const message = error.message ?? String(err);
      return {
        isValid: false,
        errorMessage: `Malformed YAML/JSON syntax: ${message}`,
        errorDetails: [
          {
            message,
            line: error.linePos?.[0]?.line,
            column: error.linePos?.[0]?.col,
            rule: 'syntax-error'
          }
        ]
      };
    }

    if (doc.errors && doc.errors.length > 0) {
      for (const err of doc.errors) {
        errors.push({
          message: err.message,
          line: err.linePos?.[0]?.line,
          column: err.linePos?.[0]?.col,
          rule: err.code === 'DUPLICATE_KEY' ? 'duplicate-declaration' : 'syntax-error'
        });
      }
    }

    // Stop early if parser syntax errors occurred
    if (errors.length > 0) {
      return {
        isValid: false,
        errorMessage: errors.map((e) => e.message).join('; '),
        errorDetails: errors
      };
    }

    const parsed = doc.toJS();
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        isValid: false,
        errorMessage: 'Root document must be a non-null object.',
        errorDetails: [
          {
            message: 'Root document must be a non-null object.',
            rule: 'invalid-root'
          }
        ]
      };
    }

    const root = parsed as Record<string, unknown>;

    // 2. Document Version & Root Check
    if (typeof root.openapi !== 'string') {
      errors.push({
        message: "Missing or invalid 'openapi' version declaration. Must be a string.",
        path: '/openapi',
        rule: 'missing-version'
      });
    } else if (!/^3\.1(\.\d+)?$/.test(root.openapi.trim())) {
      errors.push({
        message: `Unsupported OpenAPI version '${root.openapi}'. Only OpenAPI 3.1.x is supported.`,
        path: '/openapi',
        rule: 'unsupported-version'
      });
    }

    // Info Object Check
    if (!root.info || typeof root.info !== 'object' || Array.isArray(root.info)) {
      errors.push({
        message: "Missing or invalid 'info' object at root.",
        path: '/info',
        rule: 'missing-info'
      });
    } else {
      const info = root.info as Record<string, unknown>;
      if (typeof info.title !== 'string' || info.title.trim().length === 0) {
        errors.push({
          message: "Root 'info' object must declare a non-empty string 'title'.",
          path: '/info/title',
          rule: 'missing-info-title'
        });
      }
      if (typeof info.version !== 'string' || info.version.trim().length === 0) {
        errors.push({
          message: "Root 'info' object must declare a non-empty string 'version'.",
          path: '/info/version',
          rule: 'missing-info-version'
        });
      }
    }

    // Core Root Elements Check
    const hasPaths = root.paths !== undefined && root.paths !== null;
    const hasWebhooks = root.webhooks !== undefined && root.webhooks !== null;
    const hasComponents = root.components !== undefined && root.components !== null;
    if (!hasPaths && !hasWebhooks && !hasComponents) {
      errors.push({
        message:
          "OpenAPI document must declare at least one of 'paths', 'webhooks', or 'components'.",
        path: '/',
        rule: 'missing-core-elements'
      });
    }

    // 3. Unique Operation IDs Tracking
    const seenOperationIds = new Map<string, { path: string; method: string }>();

    // 4. Paths & Operations Structure
    if (hasPaths) {
      if (typeof root.paths !== 'object' || Array.isArray(root.paths)) {
        errors.push({
          message: "'paths' field must be an object.",
          path: '/paths',
          rule: 'invalid-paths'
        });
      } else {
        const paths = root.paths as Record<string, unknown>;
        for (const [pathKey, pathVal] of Object.entries(paths)) {
          const pathPointer = `/paths/${pathKey.replace(/~/g, '~0').replace(/\//g, '~1')}`;

          if (!pathKey.startsWith('/')) {
            errors.push({
              message: `Path key '${pathKey}' must begin with a forward slash '/'.`,
              path: pathPointer,
              rule: 'invalid-path-key'
            });
          }

          if (pathVal === null || typeof pathVal !== 'object' || Array.isArray(pathVal)) {
            errors.push({
              message: `Path item at '${pathKey}' must be an object.`,
              path: pathPointer,
              rule: 'invalid-path-item'
            });
            continue;
          }

          const pathItem = pathVal as Record<string, unknown>;

          // Extract path template parameters, e.g. /users/{userId}/orders/{orderId}
          const templateParams: string[] = [];
          const paramRegex = /\{([^}]+)\}/g;
          let match: RegExpExecArray | null;
          while ((match = paramRegex.exec(pathKey)) !== null) {
            templateParams.push(match[1]);
          }

          // Path-level parameters
          const pathLevelParams: Array<Record<string, unknown>> = [];
          if (Array.isArray(pathItem.parameters)) {
            const seenPathParams = new Set<string>();
            for (let i = 0; i < pathItem.parameters.length; i++) {
              const param = pathItem.parameters[i];
              const paramPointer = `${pathPointer}/parameters/${i}`;
              if (param && typeof param === 'object' && !Array.isArray(param)) {
                const p = param as Record<string, unknown>;
                this.validateParameter(p, paramPointer, errors);
                const paramKey = `${p.name}:${p.in}`;
                if (seenPathParams.has(paramKey)) {
                  errors.push({
                    message: `Duplicate parameter declaration '${p.name}' in '${p.in}' at path '${pathKey}'.`,
                    path: paramPointer,
                    rule: 'duplicate-parameter'
                  });
                } else {
                  seenPathParams.add(paramKey);
                }
                pathLevelParams.push(p);
              }
            }
          }

          // Inspect operations
          for (const [opKey, opVal] of Object.entries(pathItem)) {
            if (
              opKey.startsWith('x-') ||
              ['summary', 'description', 'servers', 'parameters'].includes(opKey)
            ) {
              continue;
            }

            const lowerMethod = opKey.toLowerCase();
            const opPointer = `${pathPointer}/${opKey}`;

            if (!VALID_HTTP_METHODS.has(lowerMethod)) {
              errors.push({
                message: `Invalid HTTP method '${opKey}' at path '${pathKey}'.`,
                path: opPointer,
                rule: 'invalid-http-method'
              });
              continue;
            }

            if (opVal === null || typeof opVal !== 'object' || Array.isArray(opVal)) {
              errors.push({
                message: `Operation '${opKey.toUpperCase()} ${pathKey}' must be an object.`,
                path: opPointer,
                rule: 'invalid-operation'
              });
              continue;
            }

            const operation = opVal as Record<string, unknown>;

            // Operation ID uniqueness check
            if (operation.operationId !== undefined) {
              if (
                typeof operation.operationId !== 'string' ||
                operation.operationId.trim().length === 0
              ) {
                errors.push({
                  message: `Operation '${opKey.toUpperCase()} ${pathKey}' has invalid operationId. Must be a non-empty string.`,
                  path: `${opPointer}/operationId`,
                  rule: 'invalid-operation-id'
                });
              } else {
                const opId = operation.operationId.trim();
                const existing = seenOperationIds.get(opId);
                if (existing) {
                  errors.push({
                    message: `Duplicate operationId '${opId}' in '${opKey.toUpperCase()} ${pathKey}', previously defined in '${existing.method.toUpperCase()} ${existing.path}'.`,
                    path: `${opPointer}/operationId`,
                    rule: 'duplicate-operation-id'
                  });
                } else {
                  seenOperationIds.set(opId, { path: pathKey, method: opKey });
                }
              }
            }

            // Operation responses check
            if (
              !operation.responses ||
              typeof operation.responses !== 'object' ||
              Array.isArray(operation.responses) ||
              Object.keys(operation.responses).length === 0
            ) {
              errors.push({
                message: `Operation '${opKey.toUpperCase()} ${pathKey}' must declare a 'responses' object with at least one response definition.`,
                path: `${opPointer}/responses`,
                rule: 'missing-operation-responses'
              });
            }

            // Operation-level parameters check
            const opLevelParams: Array<Record<string, unknown>> = [];
            if (Array.isArray(operation.parameters)) {
              const seenOpParams = new Set<string>();
              for (let i = 0; i < operation.parameters.length; i++) {
                const param = operation.parameters[i];
                const paramPointer = `${opPointer}/parameters/${i}`;
                if (param && typeof param === 'object' && !Array.isArray(param)) {
                  const p = param as Record<string, unknown>;
                  this.validateParameter(p, paramPointer, errors);
                  const paramKey = `${p.name}:${p.in}`;
                  if (seenOpParams.has(paramKey)) {
                    errors.push({
                      message: `Duplicate parameter declaration '${p.name}' in '${p.in}' in operation '${opKey.toUpperCase()} ${pathKey}'.`,
                      path: paramPointer,
                      rule: 'duplicate-parameter'
                    });
                  } else {
                    seenOpParams.add(paramKey);
                  }
                  opLevelParams.push(p);
                }
              }
            }

            // Path template parameters integrity check
            const combinedParams = [...pathLevelParams, ...opLevelParams];
            for (const tParam of templateParams) {
              const matching = combinedParams.find((p) => p.name === tParam && p.in === 'path');
              if (!matching) {
                errors.push({
                  message: `Missing path parameter declaration for '{${tParam}}' in operation '${opKey.toUpperCase()} ${pathKey}'.`,
                  path: opPointer,
                  rule: 'missing-path-parameter'
                });
              } else if (matching.required !== true) {
                errors.push({
                  message: `Path parameter '{${tParam}}' in operation '${opKey.toUpperCase()} ${pathKey}' must have required: true.`,
                  path: opPointer,
                  rule: 'invalid-parameter-definition'
                });
              }
            }
          }
        }
      }
    }

    // 5. Component Schema References & Resolvable $ref Values
    this.validateReferences(root, errors);

    // 6. Required Fields & Valid Schema Shapes Check
    this.validateSchemas(root, errors);

    if (errors.length > 0) {
      return {
        isValid: false,
        errorMessage: errors.map((e) => e.message).join('; '),
        errorDetails: errors
      };
    }

    return {
      isValid: true,
      parsedDocument: root
    };
  }

  private validateParameter(
    param: Record<string, unknown>,
    pointer: string,
    errors: OpenApiValidationErrorDetails[]
  ): void {
    if (typeof param.name !== 'string' || param.name.trim().length === 0) {
      errors.push({
        message: `Parameter at '${pointer}' must declare a non-empty string 'name'.`,
        path: `${pointer}/name`,
        rule: 'invalid-parameter-definition'
      });
    }
    if (typeof param.in !== 'string' || !VALID_PARAMETER_LOCATIONS.has(param.in)) {
      errors.push({
        message: `Parameter '${param.name ?? 'unknown'}' at '${pointer}' has invalid 'in' location '${param.in}'. Must be one of query, header, path, cookie.`,
        path: `${pointer}/in`,
        rule: 'invalid-parameter-definition'
      });
    }
    if (param.in === 'path' && param.required !== true) {
      errors.push({
        message: `Path parameter '${param.name}' at '${pointer}' must have required: true.`,
        path: `${pointer}/required`,
        rule: 'invalid-parameter-definition'
      });
    }
  }

  private validateReferences(
    root: Record<string, unknown>,
    errors: OpenApiValidationErrorDetails[]
  ): void {
    const refs: Array<{ ref: string; pointer: string }> = [];

    const traverse = (node: unknown, currentPointer: string) => {
      if (node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          traverse(node[i], `${currentPointer}/${i}`);
        }
        return;
      }

      const obj = node as Record<string, unknown>;
      if (typeof obj.$ref === 'string') {
        refs.push({ ref: obj.$ref, pointer: `${currentPointer}/$ref` });
      }

      for (const [k, v] of Object.entries(obj)) {
        const escapedKey = k.replace(/~/g, '~0').replace(/\//g, '~1');
        traverse(v, `${currentPointer}/${escapedKey}`);
      }
    };

    traverse(root, '#');

    for (const { ref, pointer } of refs) {
      if (!ref.startsWith('#/')) {
        // We do not resolve external remote refs in isolated validation
        continue;
      }

      const segments = ref
        .slice(2)
        .split('/')
        .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));

      let current: unknown = root;
      let resolvable = true;

      for (const segment of segments) {
        if (
          current === null ||
          typeof current !== 'object' ||
          !(segment in (current as Record<string, unknown>))
        ) {
          resolvable = false;
          break;
        }
        current = (current as Record<string, unknown>)[segment];
      }

      if (!resolvable || current === undefined) {
        errors.push({
          message: `Unresolvable $ref '${ref}' at '${pointer}'.`,
          path: pointer,
          rule: 'unresolvable-ref'
        });
      }
    }

    // Check for circular reference loops in component schema aliases
    if (root.components && typeof root.components === 'object' && !Array.isArray(root.components)) {
      const components = root.components as Record<string, unknown>;
      if (
        components.schemas &&
        typeof components.schemas === 'object' &&
        !Array.isArray(components.schemas)
      ) {
        const schemas = components.schemas as Record<string, unknown>;
        for (const [schemaName, schemaVal] of Object.entries(schemas)) {
          if (schemaVal && typeof schemaVal === 'object' && !Array.isArray(schemaVal)) {
            const visited = new Set<string>();
            let currName: string | undefined = schemaName;
            let currObj: unknown = schemaVal;

            while (currObj && typeof currObj === 'object' && !Array.isArray(currObj)) {
              const obj = currObj as Record<string, unknown>;
              // If it's a pure $ref alias without other properties
              if (typeof obj.$ref === 'string' && obj.$ref.startsWith('#/components/schemas/')) {
                const targetName = obj.$ref.slice('#/components/schemas/'.length);
                if (visited.has(targetName)) {
                  errors.push({
                    message: `Circular reference detected in schema '${schemaName}' pointing back to '${targetName}'.`,
                    path: `#/components/schemas/${schemaName}`,
                    rule: 'circular-ref'
                  });
                  break;
                }
                visited.add(currName);
                currName = targetName;
                currObj = schemas[targetName];
              } else {
                break;
              }
            }
          }
        }
      }
    }
  }

  private validateSchemas(
    root: Record<string, unknown>,
    errors: OpenApiValidationErrorDetails[]
  ): void {
    const visitedSchemas = new Set<unknown>();

    const checkSchema = (schema: unknown, pointer: string) => {
      if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return;
      if (visitedSchemas.has(schema)) return;
      visitedSchemas.add(schema);

      const s = schema as Record<string, unknown>;

      // Validate 'type'
      if (s.type !== undefined) {
        if (typeof s.type === 'string') {
          if (!VALID_PRIMITIVE_TYPES.has(s.type)) {
            errors.push({
              message: `Invalid schema type '${s.type}' at '${pointer}'.`,
              path: `${pointer}/type`,
              rule: 'invalid-schema-type'
            });
          }
        } else if (Array.isArray(s.type)) {
          for (let i = 0; i < s.type.length; i++) {
            const t = s.type[i];
            if (typeof t !== 'string' || !VALID_PRIMITIVE_TYPES.has(t)) {
              errors.push({
                message: `Invalid schema type union member '${String(t)}' at '${pointer}/type/${i}'.`,
                path: `${pointer}/type/${i}`,
                rule: 'invalid-schema-type'
              });
            }
          }
        } else {
          errors.push({
            message: `Schema 'type' at '${pointer}' must be a string or array of strings.`,
            path: `${pointer}/type`,
            rule: 'invalid-schema-type'
          });
        }
      }

      // Validate 'required' fields against 'properties'
      if (s.required !== undefined) {
        if (!Array.isArray(s.required)) {
          errors.push({
            message: `Schema 'required' at '${pointer}' must be an array of strings.`,
            path: `${pointer}/required`,
            rule: 'invalid-required-definition'
          });
        } else {
          for (let i = 0; i < s.required.length; i++) {
            const reqField = s.required[i];
            if (typeof reqField !== 'string' || reqField.trim().length === 0) {
              errors.push({
                message: `Schema 'required' at '${pointer}/required/${i}' must be a non-empty string.`,
                path: `${pointer}/required/${i}`,
                rule: 'invalid-required-definition'
              });
            }
          }

          // Check required properties exist in properties if properties is defined
          if (s.properties && typeof s.properties === 'object' && !Array.isArray(s.properties)) {
            const propKeys = new Set(Object.keys(s.properties as Record<string, unknown>));
            // Only enforce if no composite keywords are used
            const hasComposite = s.allOf || s.anyOf || s.oneOf || s.$ref;
            if (!hasComposite) {
              for (const reqField of s.required) {
                if (typeof reqField === 'string' && !propKeys.has(reqField)) {
                  errors.push({
                    message: `Required property '${reqField}' is not defined in properties at '${pointer}'.`,
                    path: `${pointer}/required`,
                    rule: 'missing-required-property'
                  });
                }
              }
            }
          }
        }
      }

      // Validate array schema has 'items'
      const isArrayType = s.type === 'array' || (Array.isArray(s.type) && s.type.includes('array'));
      if (isArrayType && s.$ref === undefined) {
        if (!s.items || (typeof s.items !== 'object' && typeof s.items !== 'boolean')) {
          errors.push({
            message: `Array schema at '${pointer}' must define an 'items' schema.`,
            path: `${pointer}/items`,
            rule: 'missing-array-items'
          });
        }
      }

      // Recurse into nested schemas
      if (s.properties && typeof s.properties === 'object' && !Array.isArray(s.properties)) {
        for (const [propName, propVal] of Object.entries(s.properties as Record<string, unknown>)) {
          const escaped = propName.replace(/~/g, '~0').replace(/\//g, '~1');
          checkSchema(propVal, `${pointer}/properties/${escaped}`);
        }
      }

      if (s.items) {
        if (Array.isArray(s.items)) {
          for (let i = 0; i < s.items.length; i++) {
            checkSchema(s.items[i], `${pointer}/items/${i}`);
          }
        } else if (typeof s.items === 'object') {
          checkSchema(s.items, `${pointer}/items`);
        }
      }

      for (const compositeKey of ['allOf', 'anyOf', 'oneOf'] as const) {
        if (Array.isArray(s[compositeKey])) {
          const compArr = s[compositeKey] as unknown[];
          for (let i = 0; i < compArr.length; i++) {
            checkSchema(compArr[i], `${pointer}/${compositeKey}/${i}`);
          }
        }
      }

      if (s.additionalProperties && typeof s.additionalProperties === 'object') {
        checkSchema(s.additionalProperties, `${pointer}/additionalProperties`);
      }
    };

    // Traverse root components.schemas
    if (root.components && typeof root.components === 'object' && !Array.isArray(root.components)) {
      const components = root.components as Record<string, unknown>;
      if (
        components.schemas &&
        typeof components.schemas === 'object' &&
        !Array.isArray(components.schemas)
      ) {
        for (const [name, schema] of Object.entries(
          components.schemas as Record<string, unknown>
        )) {
          const escaped = name.replace(/~/g, '~0').replace(/\//g, '~1');
          checkSchema(schema, `#/components/schemas/${escaped}`);
        }
      }
    }

    // Traverse inline schemas in paths
    if (root.paths && typeof root.paths === 'object' && !Array.isArray(root.paths)) {
      const traversePaths = (node: unknown, currPointer: string) => {
        if (node === null || typeof node !== 'object') return;
        if (Array.isArray(node)) {
          for (let i = 0; i < node.length; i++) {
            traversePaths(node[i], `${currPointer}/${i}`);
          }
          return;
        }
        const obj = node as Record<string, unknown>;
        if (obj.schema && typeof obj.schema === 'object') {
          checkSchema(obj.schema, `${currPointer}/schema`);
        }
        for (const [k, v] of Object.entries(obj)) {
          if (k === 'schema') continue;
          const escaped = k.replace(/~/g, '~0').replace(/\//g, '~1');
          traversePaths(v, `${currPointer}/${escaped}`);
        }
      };
      traversePaths(root.paths, '#/paths');
    }
  }
}
