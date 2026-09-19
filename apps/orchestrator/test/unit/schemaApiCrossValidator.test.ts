import { describe, it, expect } from 'vitest';
import {
  createRequirementsBaseline,
  createRequirementsBaselineId,
  createRequirementRevision,
  createRequirementRevisionId,
  createRequirementId,
  createReviewerId,
  createInstant
} from '@solutions-studio/domain';
import {
  SchemaApiCrossValidator,
  parseSqlTables,
  parseSqlEnums,
  resolveSchemaRef,
  extractProperties,
  extractRequired,
  resolveTableAlias,
  normalizeName,
  hasStateTransitionAnnotation,
  isEnumSchema,
  matchesCheckConstraintEnum,
  isChildTableOf,
  isParentForeignKey,
  hasBackingChildTable,
  stripSqlComments,
  hasForeignKeyToParent
} from '../../src/application/use-cases/crossValidation/schemaApiCrossValidator.js';

describe('SchemaApiCrossValidator', () => {
  const validator = new SchemaApiCrossValidator();

  const rev1 = createRequirementRevision({
    id: createRequirementRevisionId('REQ-001-R1'),
    requirementId: createRequirementId('REQ-001'),
    revision: 1,
    statement: 'System entities',
    category: 'business-rule',
    origin: 'ASSUMED',
    reviewState: 'ACCEPTED',
    resolutionState: 'CLEAR'
  });

  const baseline = createRequirementsBaseline({
    id: createRequirementsBaselineId('BASE-001'),
    requirements: [rev1],
    createdBy: createReviewerId('REV-LEAD'),
    createdAt: createInstant('2026-09-18T12:00:00.000Z')
  });

  it('normalizes entity and column names correctly', () => {
    expect(normalizeName('Users')).toBe('user');
    expect(normalizeName('accounts')).toBe('account');
    expect(normalizeName('Categories')).toBe('category');
    expect(normalizeName('phone_number')).toBe('phonenumber');
    expect(normalizeName('phoneNumber')).toBe('phonenumber');
    expect(normalizeName('tax_id')).toBe('taxid');
    expect(normalizeName('processes')).toBe('process');
    expect(normalizeName('order-statuses')).toBe('orderstatu');
    expect(normalizeName('order-statuses')).toBe(normalizeName('order_status'));
  });

  it('parses SQL table definitions and extracts columns and primary keys', () => {
    const sql = `
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) NOT NULL UNIQUE,
        bio TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE orders (
        order_id INT,
        user_id UUID NOT NULL,
        amount NUMERIC(10, 2) NOT NULL,
        CONSTRAINT pk_orders PRIMARY KEY (order_id)
      );
    `;

    const tables = parseSqlTables(sql);
    expect(tables).toHaveLength(2);

    expect(tables[0].name).toBe('users');
    expect(tables[0].columns.find((c) => c.name === 'id')?.isPrimaryKey).toBe(true);
    expect(tables[0].columns.find((c) => c.name === 'email')?.isNotNull).toBe(true);

    expect(tables[1].name).toBe('orders');
    expect(tables[1].columns.find((c) => c.name === 'order_id')?.isPrimaryKey).toBe(true);
  });

  it('parses SQL enum definitions correctly', () => {
    const sql = `
      CREATE TYPE order_status AS ENUM ('PENDING', 'PAID', 'SHIPPED', 'CANCELLED');
      CREATE TYPE IF NOT EXISTS payment_method AS ENUM (
        'CREDIT_CARD', -- card payment
        'BANK_TRANSFER'
      );
      CREATE TYPE public."delivery_mode" AS ENUM ('STANDARD', 'EXPRESS');
    `;

    const enums = parseSqlEnums(sql);
    expect(enums).toHaveLength(3);

    expect(enums[0].name).toBe('order_status');
    expect(enums[0].values).toEqual(['PENDING', 'PAID', 'SHIPPED', 'CANCELLED']);

    expect(enums[1].name).toBe('payment_method');
    expect(enums[1].values).toEqual(['CREDIT_CARD', 'BANK_TRANSFER']);

    expect(enums[2].name).toBe('delivery_mode');
    expect(enums[2].values).toEqual(['STANDARD', 'EXPRESS']);
  });

  it('resolves schema $ref references and extracts properties including allOf', () => {
    const openApiDoc = {
      components: {
        schemas: {
          BaseEntity: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              created_at: { type: 'string' }
            },
            required: ['id']
          },
          CreateOrderRequest: {
            allOf: [
              { $ref: '#/components/schemas/BaseEntity' },
              {
                type: 'object',
                properties: {
                  customer_id: { type: 'string' },
                  amount: { type: 'number' }
                },
                required: ['customer_id', 'amount']
              }
            ]
          }
        }
      }
    };

    const resolved = resolveSchemaRef(
      { $ref: '#/components/schemas/CreateOrderRequest' },
      openApiDoc
    );
    expect(resolved).toBeDefined();

    const props = extractProperties(resolved, openApiDoc);
    expect(Object.keys(props)).toContain('id');
    expect(Object.keys(props)).toContain('customer_id');
    expect(Object.keys(props)).toContain('amount');

    const required = extractRequired(resolved, openApiDoc);
    expect(required).toContain('id');
    expect(required).toContain('customer_id');
    expect(required).toContain('amount');
  });

  it('detects missing relational table for declared OpenAPI entity schema (Rule 1)', () => {
    const sql = `CREATE TABLE users (id UUID PRIMARY KEY, name TEXT NOT NULL);`;
    const openApiDoc = {
      openapi: '3.1.0',
      components: {
        schemas: {
          User: {
            type: 'object',
            properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } }
          },
          Subscription: {
            type: 'object',
            properties: { id: { type: 'string' } }
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-1',
      sqlSchemaProjectionId: 'PROJ-SQL-1'
    });

    const missingSub = findings.find(
      (f) => f.type === 'data-boundary-ambiguity' && f.rationale?.includes('Subscription')
    );
    expect(missingSub).toBeDefined();
    expect(missingSub?.discoveredBy).toBe('artifact-validation');
    expect(missingSub?.disposition).toBe('OPEN');
  });

  it('detects identifier type contradiction between OpenAPI and SQL schema (Rule 2)', () => {
    const sql = `CREATE TABLE users (id UUID PRIMARY KEY, name TEXT NOT NULL);`;
    const openApiDoc = {
      openapi: '3.1.0',
      components: {
        schemas: {
          User: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              name: { type: 'string' }
            }
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-2',
      sqlSchemaProjectionId: 'PROJ-SQL-2'
    });

    const contradiction = findings.find(
      (f) =>
        f.type === 'contradiction' &&
        f.rationale?.includes('integer') &&
        f.rationale?.includes('UUID')
    );
    expect(contradiction).toBeDefined();
    expect(contradiction?.discoveredBy).toBe('artifact-validation');
  });

  it('detects unrepresentable required API fields and missing mandatory DB columns (Rule 3)', () => {
    const sql = `
      CREATE TABLE accounts (
        id UUID PRIMARY KEY,
        tax_id VARCHAR NOT NULL,
        legal_name TEXT NOT NULL
      );
    `;
    const openApiDoc = {
      openapi: '3.1.0',
      components: {
        schemas: {
          Account: {
            type: 'object',
            required: ['taxId', 'unsupportedField'],
            properties: {
              taxId: { type: 'string' },
              unsupportedField: { type: 'string' }
            }
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-3',
      sqlSchemaProjectionId: 'PROJ-SQL-3'
    });

    // unsupportedField is required in API but missing from table
    const unrep = findings.find(
      (f) => f.type === 'data-boundary-ambiguity' && f.rationale?.includes('unsupportedField')
    );
    expect(unrep).toBeDefined();

    // legal_name is NOT NULL without default in table but missing from API schema
    const missingDbCol = findings.find(
      (f) => f.type === 'data-boundary-ambiguity' && f.rationale?.includes('legal_name')
    );
    expect(missingDbCol).toBeDefined();
  });

  it('detects cardinality conflicts and scalar type contradictions (Rule 4)', () => {
    const sql = `
      CREATE TABLE products (
        id UUID PRIMARY KEY,
        tags VARCHAR NOT NULL,
        is_active INT NOT NULL
      );
    `;
    const openApiDoc = {
      openapi: '3.1.0',
      components: {
        schemas: {
          Product: {
            type: 'object',
            properties: {
              tags: {
                type: 'array',
                items: { type: 'string' }
              },
              isActive: {
                type: 'boolean'
              }
            }
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-4',
      sqlSchemaProjectionId: 'PROJ-SQL-4'
    });

    // Array tags vs VARCHAR scalar
    const cardConflict = findings.find(
      (f) => f.type === 'undefined-cardinality' && f.rationale?.includes('tags')
    );
    expect(cardConflict).toBeDefined();

    // boolean isActive vs INT
    const typeConflict = findings.find(
      (f) => f.type === 'contradiction' && f.rationale?.includes('boolean')
    );
    expect(typeConflict).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // Acceptance Criteria Tests: False-Positive Fixes
  // --------------------------------------------------------------------------

  it('allows enum-backed OpenAPI schema when CREATE TYPE ... AS ENUM exists (Bug 1)', () => {
    const sql = `
      CREATE TYPE order_status AS ENUM ('PENDING', 'PAID', 'SHIPPED', 'CANCELLED');
      CREATE TABLE orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        status order_status NOT NULL,
        total NUMERIC NOT NULL
      );
    `;
    const openApiDoc = {
      openapi: '3.1.0',
      components: {
        schemas: {
          Order: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              status: { $ref: '#/components/schemas/OrderStatus' },
              total: { type: 'number' }
            }
          },
          OrderStatus: {
            type: 'string',
            enum: ['PENDING', 'PAID', 'SHIPPED', 'CANCELLED']
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-ENUM',
      sqlSchemaProjectionId: 'PROJ-SQL-ENUM'
    });

    const enumFinding = findings.find((f) => f.rationale?.includes('OrderStatus'));
    expect(enumFinding).toBeUndefined();
  });

  it('ignores pluralized error schemas like ProblemDetails (Bug 2)', () => {
    const sql = `CREATE TABLE orders (id UUID PRIMARY KEY);`;
    const openApiDoc = {
      openapi: '3.1.0',
      components: {
        schemas: {
          Order: {
            type: 'object',
            properties: { id: { type: 'string' } }
          },
          ProblemDetails: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              title: { type: 'string' },
              status: { type: 'integer' },
              detail: { type: 'string' }
            }
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-IGNORE',
      sqlSchemaProjectionId: 'PROJ-SQL-IGNORE'
    });

    const pdFinding = findings.find((f) => f.rationale?.includes('ProblemDetails'));
    expect(pdFinding).toBeUndefined();
  });

  it('recognizes action verbs and @decision state-transition paths like /orders/{id}/pay (Bug 3)', () => {
    const sql = `
      CREATE TABLE orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        payment_authorization_id VARCHAR(64),
        payment_authorization_verified BOOLEAN NOT NULL DEFAULT false
      );
    `;
    const openApiDoc = {
      openapi: '3.1.0',
      paths: {
        '/orders/{id}/pay': {
          description:
            '# @decision: Model payment verification as a dedicated state-transition resource POST /orders/{id}/pay | Prevents arbitrary state mutation',
          post: {
            summary: 'Pay an order',
            responses: {
              '200': { description: 'Paid' }
            }
          }
        }
      },
      components: {
        schemas: {
          Order: {
            type: 'object',
            properties: { id: { type: 'string' } }
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-PATH',
      sqlSchemaProjectionId: 'PROJ-SQL-PATH'
    });

    const pathFinding = findings.find(
      (f) => f.rationale?.includes('/orders/{id}/pay') || f.rationale?.includes("'pay'")
    );
    expect(pathFinding).toBeUndefined();
  });

  it('dereferences $ref in POST requestBody to satisfy mandatory NOT NULL columns (Bug 4)', () => {
    const sql = `
      CREATE TABLE orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id VARCHAR(64) NOT NULL,
        amount NUMERIC(10, 2) NOT NULL
      );
    `;
    const openApiDoc = {
      openapi: '3.1.0',
      paths: {
        '/orders': {
          post: {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/CreateOrderRequest'
                  }
                }
              }
            },
            responses: {
              '201': { description: 'Created' }
            }
          }
        }
      },
      components: {
        schemas: {
          Order: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              customer_id: { type: 'string' },
              amount: { type: 'number' }
            }
          },
          CreateOrderRequest: {
            type: 'object',
            required: ['customer_id', 'amount'],
            properties: {
              customer_id: { type: 'string' },
              amount: { type: 'number' }
            }
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-REF',
      sqlSchemaProjectionId: 'PROJ-SQL-REF'
    });

    const missingCol = findings.find(
      (f) => f.rationale?.includes('customer_id') || f.rationale?.includes('amount')
    );
    expect(missingCol).toBeUndefined();
  });

  it('resolves naming-convention alias between LineItem schema and order_items table (Item 5)', () => {
    const sql = `
      CREATE TABLE orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid()
      );

      CREATE TABLE order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL,
        product_id VARCHAR(64) NOT NULL,
        quantity INT NOT NULL
      );
    `;
    const openApiDoc = {
      openapi: '3.1.0',
      components: {
        schemas: {
          Order: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              items: {
                type: 'array',
                items: { $ref: '#/components/schemas/LineItem' }
              }
            }
          },
          LineItem: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              productId: { type: 'string' },
              quantity: { type: 'integer' }
            }
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-ALIAS',
      sqlSchemaProjectionId: 'PROJ-SQL-ALIAS'
    });

    const lineItemFinding = findings.find((f) => f.rationale?.includes('LineItem'));
    expect(lineItemFinding).toBeUndefined();

    const tables = parseSqlTables(sql);
    const tableMap = new Map(tables.map((t) => [normalizeName(t.name), t]));
    expect(resolveTableAlias('lineitem', tableMap)?.name).toBe('order_items');
  });

  // --------------------------------------------------------------------------
  // Regression Tests: Preservation of True Positives
  // --------------------------------------------------------------------------

  it('preserves true positive: flags genuine missing table for declared OpenAPI schema', () => {
    const sql = `
      CREATE TABLE orders (id UUID PRIMARY KEY);
      CREATE TYPE order_status AS ENUM ('PENDING', 'PAID');
    `;
    const openApiDoc = {
      openapi: '3.1.0',
      components: {
        schemas: {
          Order: { type: 'object', properties: { id: { type: 'string' } } },
          OrderStatus: { type: 'string', enum: ['PENDING', 'PAID'] },
          Widget: { type: 'object', properties: { id: { type: 'string' } } }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-TP1',
      sqlSchemaProjectionId: 'PROJ-SQL-TP1'
    });

    const widgetFinding = findings.find(
      (f) => f.type === 'data-boundary-ambiguity' && f.rationale?.includes('Widget')
    );
    expect(widgetFinding).toBeDefined();
    expect(widgetFinding?.rationale).toContain("OpenAPI declares entity schema 'Widget'");
  });

  it('preserves true positive: flags genuine missing mandatory field in $ref request body', () => {
    const sql = `
      CREATE TABLE orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id VARCHAR(64) NOT NULL,
        amount NUMERIC(10, 2) NOT NULL
      );
    `;
    const openApiDoc = {
      openapi: '3.1.0',
      paths: {
        '/orders': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/CreateOrderRequest'
                  }
                }
              }
            }
          }
        }
      },
      components: {
        schemas: {
          CreateOrderRequest: {
            type: 'object',
            required: ['amount'],
            // customer_id is NOT defined in properties
            properties: {
              amount: { type: 'number' }
            }
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-TP2',
      sqlSchemaProjectionId: 'PROJ-SQL-TP2'
    });

    const customerFinding = findings.find(
      (f) => f.type === 'data-boundary-ambiguity' && f.rationale?.includes('customer_id')
    );
    expect(customerFinding).toBeDefined();
    expect(customerFinding?.rationale).toContain(
      "SQL table 'orders' defines mandatory column 'customer_id' (NOT NULL with no default), but field is missing from OpenAPI schema."
    );
  });

  it('preserves true positive: flags genuine path-to-table mismatch for real CRUD resource', () => {
    const sql = `CREATE TABLE orders (id UUID PRIMARY KEY);`;
    const openApiDoc = {
      openapi: '3.1.0',
      paths: {
        '/orders': {
          get: { responses: { '200': { description: 'ok' } } }
        },
        '/shipments': {
          get: { responses: { '200': { description: 'ok' } } }
        },
        '/shipments/{id}': {
          get: { responses: { '200': { description: 'ok' } } }
        }
      },
      components: {
        schemas: {
          Order: { type: 'object', properties: { id: { type: 'string' } } }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-TP3',
      sqlSchemaProjectionId: 'PROJ-SQL-TP3'
    });

    const shipmentFinding = findings.find(
      (f) => f.type === 'data-boundary-ambiguity' && f.rationale?.includes('/shipments')
    );
    expect(shipmentFinding).toBeDefined();
    expect(shipmentFinding?.rationale).toContain("resource 'shipments'");
  });

  it('does not let action endpoint POST /orders/{id}/pay overwrite create DTO from POST /orders (AC-1)', () => {
    const sql = `
      CREATE TABLE orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id VARCHAR(64) NOT NULL,
        amount NUMERIC(10, 2) NOT NULL
      );
    `;
    const openApiDoc = {
      openapi: '3.1.0',
      paths: {
        '/orders': {
          post: {
            summary: 'Create an order',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/CreateOrderRequest'
                  }
                }
              }
            },
            responses: {
              '201': { description: 'Created' }
            }
          }
        },
        '/orders/{id}/pay': {
          post: {
            summary: 'Pay an order',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/PayOrderRequest'
                  }
                }
              }
            },
            responses: {
              '200': { description: 'Paid' }
            }
          }
        }
      },
      components: {
        schemas: {
          Order: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              customer_id: { type: 'string' },
              amount: { type: 'number' }
            }
          },
          CreateOrderRequest: {
            type: 'object',
            required: ['customer_id', 'amount'],
            properties: {
              customer_id: { type: 'string' },
              amount: { type: 'number' }
            }
          },
          PayOrderRequest: {
            type: 'object',
            required: ['payment_method', 'token'],
            properties: {
              payment_method: { type: 'string' },
              token: { type: 'string' }
            }
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-REG-PAY',
      sqlSchemaProjectionId: 'PROJ-SQL-REG-PAY'
    });

    const missingCol = findings.find(
      (f) => f.rationale?.includes('customer_id') || f.rationale?.includes('amount')
    );
    expect(missingCol).toBeUndefined();

    const payFinding = findings.find(
      (f) => f.rationale?.includes('/orders/{id}/pay') || f.rationale?.includes("'pay'")
    );
    expect(payFinding).toBeUndefined();
    expect(findings).toHaveLength(0);
  });

  it('allows resource path backed by an enum type without requiring a table (AC-2)', () => {
    const sql = `
      CREATE TABLE orders (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
      CREATE TYPE order_status AS ENUM ('PENDING', 'PAID', 'SHIPPED', 'CANCELLED');
    `;
    const openApiDoc = {
      openapi: '3.1.0',
      paths: {
        '/orders': {
          get: { responses: { '200': { description: 'List orders' } } }
        },
        '/order-statuses': {
          get: {
            summary: 'List available order statuses',
            responses: {
              '200': {
                description: 'List of order statuses',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/OrderStatus' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      components: {
        schemas: {
          Order: { type: 'object', properties: { id: { type: 'string' } } },
          OrderStatus: {
            type: 'string',
            enum: ['PENDING', 'PAID', 'SHIPPED', 'CANCELLED']
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-ENUM-PATH',
      sqlSchemaProjectionId: 'PROJ-SQL-ENUM-PATH'
    });

    const enumPathFinding = findings.find(
      (f) => f.rationale?.includes('order-statuses') || f.rationale?.includes('orderstatus')
    );
    expect(enumPathFinding).toBeUndefined();
    expect(findings).toHaveLength(0);
  });

  it('detects state-transition annotations and rejects unrelated decision comments (AC-3)', () => {
    expect(
      hasStateTransitionAnnotation({
        description:
          '# @decision: Model payment verification as a dedicated state-transition resource POST /orders/{id}/pay'
      })
    ).toBe(true);

    expect(
      hasStateTransitionAnnotation({
        description: '# @decision: paginate list endpoints'
      })
    ).toBe(false);
  });

  it('preserves true positive: flags missing table for path with unrelated @decision text (AC-3)', () => {
    const sql = `CREATE TABLE orders (id UUID PRIMARY KEY);`;
    const openApiDoc = {
      openapi: '3.1.0',
      paths: {
        '/orders/{id}/bogus': {
          description: '# @decision: paginate list endpoints',
          get: {
            responses: { '200': { description: 'ok' } }
          }
        }
      },
      components: {
        schemas: {
          Order: { type: 'object', properties: { id: { type: 'string' } } }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-BOGUS-DECISION',
      sqlSchemaProjectionId: 'PROJ-SQL-BOGUS-DECISION'
    });

    const bogusFinding = findings.find(
      (f) => f.type === 'data-boundary-ambiguity' && f.rationale?.includes('bogus')
    );
    expect(bogusFinding).toBeDefined();
    expect(bogusFinding?.rationale).toContain("resource 'bogus'");
  });

  it('preserves true positive: flags missing table for mutating nested CRUD resource without table (AC-3)', () => {
    const sql = `CREATE TABLE orders (id UUID PRIMARY KEY);`;
    const openApiDoc = {
      openapi: '3.1.0',
      paths: {
        '/orders/{id}/widgets': {
          post: {
            summary: 'Create widget for order',
            responses: { '201': { description: 'created' } }
          }
        }
      },
      components: {
        schemas: {
          Order: { type: 'object', properties: { id: { type: 'string' } } }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-NESTED-CRUD',
      sqlSchemaProjectionId: 'PROJ-SQL-NESTED-CRUD'
    });

    const widgetFinding = findings.find(
      (f) => f.type === 'data-boundary-ambiguity' && f.rationale?.includes('widgets')
    );
    expect(widgetFinding).toBeDefined();
    expect(widgetFinding?.rationale).toContain("resource 'widgets'");
  });

  it('falls back to suffix matching when normSchema.endsWith(item) for non-lineitem schemas (AC-4)', () => {
    const sql = `
      CREATE TABLE orders (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
      CREATE TABLE order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL,
        name TEXT NOT NULL
      );
    `;
    const tables = parseSqlTables(sql);
    const tableMap = new Map(tables.map((t) => [normalizeName(t.name), t]));

    // resolveTableAlias with non-lineitem 'purchaseitem'
    const aliasMatch = resolveTableAlias('purchaseitem', tableMap);
    expect(aliasMatch).toBeDefined();
    expect(aliasMatch?.name).toBe('order_items');

    const openApiDoc = {
      openapi: '3.1.0',
      components: {
        schemas: {
          Order: { type: 'object', properties: { id: { type: 'string' } } },
          PurchaseItem: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' }
            }
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-PURCHASE-ITEM',
      sqlSchemaProjectionId: 'PROJ-SQL-PURCHASE-ITEM'
    });

    const itemFinding = findings.find((f) => f.rationale?.includes('PurchaseItem'));
    expect(itemFinding).toBeUndefined();
  });

  // Issue #82: Phase 3.10 — schemaApiCrossValidator false-positive elimination

  it('UT-1: allows table-level VARCHAR + CHECK constraint satisfying OpenAPI enum schema (Scope 1)', () => {
    const sql = `
      CREATE TABLE orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
        CONSTRAINT chk_orders_status CHECK (status IN ('PENDING', 'PAID', 'SHIPPED', 'CANCELLED'))
      );
    `;
    const openApiDoc = {
      openapi: '3.1.0',
      paths: {
        '/orders': {
          get: { responses: { '200': { description: 'List orders' } } }
        }
      },
      components: {
        schemas: {
          Order: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              customer_id: { type: 'string', format: 'uuid' },
              status: { $ref: '#/components/schemas/OrderStatus' }
            }
          },
          OrderStatus: {
            type: 'string',
            enum: ['PENDING', 'PAID', 'SHIPPED', 'CANCELLED']
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-UT1',
      sqlSchemaProjectionId: 'PROJ-SQL-UT1'
    });

    const statusFinding = findings.find(
      (f) => f.rationale?.includes('OrderStatus') || f.rationale?.includes('orderstatus')
    );
    expect(statusFinding).toBeUndefined();
    expect(findings).toHaveLength(0);
  });

  it('UT-2: allows column-level inline VARCHAR + CHECK constraint satisfying enum schema (Scope 1)', () => {
    const sql = `
      CREATE TABLE accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        status VARCHAR(32) NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED'))
      );
    `;
    const openApiDoc = {
      openapi: '3.1.0',
      paths: {
        '/accounts': {
          get: { responses: { '200': { description: 'List accounts' } } }
        }
      },
      components: {
        schemas: {
          Account: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              status: { $ref: '#/components/schemas/AccountStatus' }
            }
          },
          AccountStatus: {
            type: 'string',
            enum: ['ACTIVE', 'SUSPENDED']
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-UT2',
      sqlSchemaProjectionId: 'PROJ-SQL-UT2'
    });

    const statusFinding = findings.find(
      (f) => f.rationale?.includes('AccountStatus') || f.rationale?.includes('accountstatus')
    );
    expect(statusFinding).toBeUndefined();
    expect(findings).toHaveLength(0);
  });

  it('UT-3: parses PostgreSQL double-parenthesized CHECK constraint syntax (Scope 1)', () => {
    const sql = `
      CREATE TABLE orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
        CONSTRAINT chk_orders_status CHECK ((status IN ('PENDING', 'PAID', 'SHIPPED', 'CANCELLED')))
      );
    `;
    const tables = parseSqlTables(sql);
    expect(tables).toHaveLength(1);
    const statusCol = tables[0].columns.find((c) => c.name === 'status');
    expect(statusCol?.checkValues).toEqual(['PENDING', 'PAID', 'SHIPPED', 'CANCELLED']);

    const openApiDoc = {
      openapi: '3.1.0',
      paths: {
        '/orders': {
          get: { responses: { '200': { description: 'List orders' } } }
        }
      },
      components: {
        schemas: {
          Order: { type: 'object', properties: { id: { type: 'string' } } },
          OrderStatus: {
            type: 'string',
            enum: ['PENDING', 'PAID', 'SHIPPED', 'CANCELLED']
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-UT3',
      sqlSchemaProjectionId: 'PROJ-SQL-UT3'
    });

    const statusFinding = findings.find(
      (f) => f.rationale?.includes('OrderStatus') || f.rationale?.includes('orderstatus')
    );
    expect(statusFinding).toBeUndefined();
    expect(findings).toHaveLength(0);
  });

  it('UT-4: allows required array property mapping to normalized child table via FK (Scope 2)', () => {
    const sql = `
      CREATE TABLE orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL
      );

      CREATE TABLE order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id UUID NOT NULL,
        quantity INT NOT NULL
      );
    `;
    const openApiDoc = {
      openapi: '3.1.0',
      paths: {
        '/orders': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/OrderCreateRequest' }
                }
              }
            },
            responses: { '201': { description: 'Created' } }
          }
        }
      },
      components: {
        schemas: {
          Order: {
            type: 'object',
            properties: { id: { type: 'string' }, customer_id: { type: 'string' } }
          },
          OrderCreateRequest: {
            type: 'object',
            required: ['customer_id', 'items'],
            properties: {
              customer_id: { type: 'string', format: 'uuid' },
              items: {
                type: 'array',
                items: { $ref: '#/components/schemas/OrderItemCreateRequest' }
              }
            }
          },
          OrderItemCreateRequest: {
            type: 'object',
            required: ['product_id', 'quantity'],
            properties: {
              product_id: { type: 'string', format: 'uuid' },
              quantity: { type: 'integer' }
            }
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-UT4',
      sqlSchemaProjectionId: 'PROJ-SQL-UT4'
    });

    const itemsFinding = findings.find(
      (f) => f.rationale?.includes("'items'") && f.rationale?.includes('orders')
    );
    expect(itemsFinding).toBeUndefined();
    expect(findings).toHaveLength(0);
  });

  it('UT-5: allows child table parent FK to be omitted from child create request contract (Scope 3)', () => {
    const sql = `
      CREATE TABLE orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid()
      );

      CREATE TABLE order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL,
        quantity INT NOT NULL,
        CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id)
      );
    `;
    const openApiDoc = {
      openapi: '3.1.0',
      components: {
        schemas: {
          Order: { type: 'object', properties: { id: { type: 'string' } } },
          OrderItemCreateRequest: {
            type: 'object',
            required: ['quantity'],
            properties: {
              quantity: { type: 'integer' }
            }
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-UT5',
      sqlSchemaProjectionId: 'PROJ-SQL-UT5'
    });

    const orderIdFinding = findings.find(
      (f) => f.rationale?.includes("'order_id'") && f.rationale?.includes('order_items')
    );
    expect(orderIdFinding).toBeUndefined();
  });

  it('UT-6: recognizes inline column REFERENCES parent foreign key (Scope 3)', () => {
    const sql = `
      CREATE TABLE orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid()
      );

      CREATE TABLE order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id),
        quantity INT NOT NULL
      );
    `;
    const tables = parseSqlTables(sql);
    const orderItemsTable = tables.find((t) => t.name === 'order_items');
    expect(orderItemsTable).toBeDefined();
    const orderIdCol = orderItemsTable?.columns.find((c) => c.name === 'order_id');
    expect(orderIdCol?.referencesTable).toBe('orders');
    expect(orderIdCol?.referencesColumn).toBe('id');
  });

  it('UT-7: preserves true positive: flags missing mandatory non-parent FK in API (Witness Scenario 5)', () => {
    const sql = `
      CREATE TABLE orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid()
      );

      CREATE TABLE products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL
      );

      CREATE TABLE order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id),
        product_id UUID NOT NULL REFERENCES products(id),
        quantity INT NOT NULL
      );
    `;
    const openApiDoc = {
      openapi: '3.1.0',
      components: {
        schemas: {
          Order: { type: 'object', properties: { id: { type: 'string' } } },
          Product: {
            type: 'object',
            properties: { id: { type: 'string' }, name: { type: 'string' } }
          },
          OrderItemCreateRequest: {
            type: 'object',
            required: ['quantity'],
            properties: {
              quantity: { type: 'integer' }
              // product_id is omitted!
            }
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-UT7',
      sqlSchemaProjectionId: 'PROJ-SQL-UT7'
    });

    const productIdFinding = findings.find(
      (f) =>
        f.type === 'data-boundary-ambiguity' &&
        f.rationale?.includes("'product_id'") &&
        f.rationale?.includes('order_items')
    );
    expect(productIdFinding).toBeDefined();
    expect(productIdFinding?.rationale).toContain(
      "SQL table 'order_items' defines mandatory column 'product_id'"
    );

    // order_id is parent FK, so it should NOT be flagged
    const orderIdFinding = findings.find(
      (f) => f.rationale?.includes("'order_id'") && f.rationale?.includes('order_items')
    );
    expect(orderIdFinding).toBeUndefined();
  });

  it('UT-8: preserves true positive: flags required array property with NO backing child table (AC-3)', () => {
    const sql = `
      CREATE TABLE orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL
      );
    `;
    const openApiDoc = {
      openapi: '3.1.0',
      components: {
        schemas: {
          Order: {
            type: 'object',
            required: ['customer_id', 'external_tags'],
            properties: {
              customer_id: { type: 'string' },
              external_tags: {
                type: 'array',
                items: { type: 'string' }
              }
            }
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-UT8',
      sqlSchemaProjectionId: 'PROJ-SQL-UT8'
    });

    const tagsFinding = findings.find(
      (f) =>
        f.type === 'data-boundary-ambiguity' &&
        f.rationale?.includes("'external_tags'") &&
        f.rationale?.includes('orders')
    );
    expect(tagsFinding).toBeDefined();
    expect(tagsFinding?.rationale).toContain("OpenAPI contract requires field 'external_tags'");
  });

  it('UT-9: preserves true positive: flags mandatory non-FK column missing from API schema (AC-3)', () => {
    const sql = `
      CREATE TABLE orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid()
      );

      CREATE TABLE order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id),
        unit_price NUMERIC NOT NULL
      );
    `;
    const openApiDoc = {
      openapi: '3.1.0',
      components: {
        schemas: {
          Order: { type: 'object', properties: { id: { type: 'string' } } },
          OrderItemCreateRequest: {
            type: 'object',
            properties: {
              // unit_price omitted!
            }
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-UT9',
      sqlSchemaProjectionId: 'PROJ-SQL-UT9'
    });

    const priceFinding = findings.find(
      (f) =>
        f.type === 'data-boundary-ambiguity' &&
        f.rationale?.includes("'unit_price'") &&
        f.rationale?.includes('order_items')
    );
    expect(priceFinding).toBeDefined();
    expect(priceFinding?.rationale).toContain(
      "SQL table 'order_items' defines mandatory column 'unit_price'"
    );
  });

  it('UT-10: preserves true positive: flags enum schema with mismatched CHECK values (AC-3)', () => {
    const sql = `
      CREATE TABLE orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
        CONSTRAINT chk_orders_status CHECK (status IN ('PENDING', 'PAID'))
      );
    `;
    const openApiDoc = {
      openapi: '3.1.0',
      components: {
        schemas: {
          Order: { type: 'object', properties: { id: { type: 'string' } } },
          PaymentMethod: {
            type: 'string',
            enum: ['CREDIT_CARD', 'WIRE']
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-UT10',
      sqlSchemaProjectionId: 'PROJ-SQL-UT10'
    });

    const paymentFinding = findings.find(
      (f) => f.type === 'data-boundary-ambiguity' && f.rationale?.includes('PaymentMethod')
    );
    expect(paymentFinding).toBeDefined();
    expect(paymentFinding?.rationale).toContain("OpenAPI declares entity schema 'PaymentMethod'");
  });

  it('UT-11: synthetic enum derived from CHECK constraint is accessible upfront in enumMap for path segments', () => {
    const sql = `
      CREATE TABLE orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
        CONSTRAINT chk_orders_status CHECK (status IN ('PENDING', 'PAID', 'SHIPPED', 'CANCELLED'))
      );
    `;
    const openApiDoc = {
      openapi: '3.1.0',
      paths: {
        '/orders': {
          get: { responses: { '200': { description: 'List orders' } } }
        },
        '/order-statuses': {
          get: {
            summary: 'List available order statuses',
            responses: { '200': { description: 'List of order statuses' } }
          }
        }
      },
      components: {
        schemas: {
          Order: { type: 'object', properties: { id: { type: 'string' } } },
          OrderStatus: {
            type: 'string',
            enum: ['PENDING', 'PAID', 'SHIPPED', 'CANCELLED']
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-UT11',
      sqlSchemaProjectionId: 'PROJ-SQL-UT11'
    });

    const enumPathFinding = findings.find(
      (f) => f.rationale?.includes('order-statuses') || f.rationale?.includes('orderstatus')
    );
    expect(enumPathFinding).toBeUndefined();
    expect(findings).toHaveLength(0);
  });

  it('evaluates isChildTableOf and isParentForeignKey correctly on parent vs lookup relationships', () => {
    const sql = `
      CREATE TABLE orders (id UUID PRIMARY KEY);
      CREATE TABLE products (id UUID PRIMARY KEY);
      CREATE TABLE order_items (
        id UUID PRIMARY KEY,
        order_id UUID NOT NULL REFERENCES orders(id),
        product_id UUID NOT NULL REFERENCES products(id)
      );
    `;
    const tables = parseSqlTables(sql);
    const tableMap = new Map(tables.map((t) => [normalizeName(t.name), t]));

    const ordersTable = tableMap.get('order')!;
    const productsTable = tableMap.get('product')!;
    const orderItemsTable = tableMap.get('orderitem')!;

    // order_items is child of orders
    expect(isChildTableOf(orderItemsTable, ordersTable, tableMap)).toBe(true);
    expect(hasForeignKeyToParent(orderItemsTable, ordersTable)).toBe(true);

    // order_items is NOT child of products (lookup relation)
    expect(isChildTableOf(orderItemsTable, productsTable, tableMap)).toBe(false);

    // order_id is parent FK on order_items
    const orderIdCol = orderItemsTable.columns.find((c) => c.name === 'order_id')!;
    expect(isParentForeignKey(orderIdCol, orderItemsTable, tableMap)).toBe(true);

    // product_id is NOT parent FK on order_items (strict parentage check prevents skipping)
    const productIdCol = orderItemsTable.columns.find((c) => c.name === 'product_id')!;
    expect(isParentForeignKey(productIdCol, orderItemsTable, tableMap)).toBe(false);
  });

  it('evaluates hasBackingChildTable correctly for singular and plural parent prefixes', () => {
    const sql = `
      CREATE TABLE orders (id UUID PRIMARY KEY);
      CREATE TABLE order_items (
        id UUID PRIMARY KEY,
        order_id UUID NOT NULL REFERENCES orders(id)
      );
    `;
    const tables = parseSqlTables(sql);
    const tableMap = new Map(tables.map((t) => [normalizeName(t.name), t]));
    const ordersTable = tableMap.get('order')!;

    const propSchema = {
      type: 'array',
      items: { $ref: '#/components/schemas/OrderItemCreateRequest' }
    };

    expect(hasBackingChildTable('items', propSchema, ordersTable, tableMap, {})).toBe(true);
    expect(hasBackingChildTable('order_items', propSchema, ordersTable, tableMap, {})).toBe(true);
    expect(
      hasBackingChildTable(
        'external_tags',
        { type: 'array', items: { type: 'string' } },
        ordersTable,
        tableMap,
        {}
      )
    ).toBe(false);
  });

  it('matchesCheckConstraintEnum matches when values match even if column name is state', () => {
    const sql = `
      CREATE TABLE orders (
        id UUID PRIMARY KEY,
        state VARCHAR(32) CHECK (state IN ('PENDING', 'PAID', 'SHIPPED', 'CANCELLED'))
      );
    `;
    const tables = parseSqlTables(sql);
    const schemaVal = {
      type: 'string',
      enum: ['PENDING', 'PAID', 'SHIPPED', 'CANCELLED']
    };

    expect(isEnumSchema(schemaVal, {})).toBe(true);
    expect(isEnumSchema({ type: 'string' }, {})).toBe(false);
    expect(matchesCheckConstraintEnum('orderstatus', schemaVal, tables, {})).toBe(true);
    expect(matchesCheckConstraintEnum('lifecycle_state', schemaVal, tables, {})).toBe(true);
    expect(
      matchesCheckConstraintEnum(
        'paymentmethod',
        { type: 'string', enum: ['CREDIT_CARD', 'WIRE'] },
        tables,
        {}
      )
    ).toBe(false);
  });

  it('parses production-style @decision SQL line comments before columns and validates enums (AC-1, F-96f9e544, F-60188821)', () => {
    const sql = `
      CREATE TABLE orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        -- @decision: Use VARCHAR(32) with CHECK constraint for order lifecycle status | Enforces valid domain
        -- states (PENDING, PAID, SHIPPED, CANCELLED) with migration flexibility
        status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
        customer_id UUID NOT NULL,
        CONSTRAINT chk_orders_status CHECK (status IN ('PENDING', 'PAID', 'SHIPPED', 'CANCELLED'))
      );
    `;
    const tables = parseSqlTables(sql);
    expect(tables).toHaveLength(1);
    const orderTable = tables[0];
    // Must NOT have parsed a dummy '--' column
    expect(orderTable.columns.find((c) => c.name === '--')).toBeUndefined();

    const statusCol = orderTable.columns.find((c) => c.name === 'status');
    expect(statusCol).toBeDefined();
    expect(statusCol?.type).toBe('VARCHAR(32)');
    expect(statusCol?.checkValues).toEqual(['PENDING', 'PAID', 'SHIPPED', 'CANCELLED']);

    const openApiDoc = {
      openapi: '3.1.0',
      paths: {
        '/orders': {
          get: { responses: { '200': { description: 'List orders' } } }
        }
      },
      components: {
        schemas: {
          Order: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              customer_id: { type: 'string', format: 'uuid' },
              status: { $ref: '#/components/schemas/OrderStatus' }
            }
          },
          OrderStatus: {
            type: 'string',
            enum: ['PENDING', 'PAID', 'SHIPPED', 'CANCELLED']
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-DECISION-COMMENT',
      sqlSchemaProjectionId: 'PROJ-SQL-DECISION-COMMENT'
    });

    const statusFinding = findings.find(
      (f) => f.rationale?.includes('OrderStatus') || f.rationale?.includes('orderstatus')
    );
    expect(statusFinding).toBeUndefined();
    expect(findings).toHaveLength(0);
  });

  it('preserves true positive: flags same-name OrderStatus enum when values are disjoint/mismatched (AC-3, F-2760e041, F-7ccd1074)', () => {
    const sql = `
      CREATE TABLE orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
        CONSTRAINT chk_orders_status CHECK (status IN ('PENDING', 'PAID'))
      );
    `;
    const openApiDoc = {
      openapi: '3.1.0',
      paths: {
        '/orders': {
          get: { responses: { '200': { description: 'List orders' } } }
        }
      },
      components: {
        schemas: {
          Order: { type: 'object', properties: { id: { type: 'string' } } },
          OrderStatus: {
            type: 'string',
            enum: ['CANCELLED', 'FAILED']
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-MISMATCHED-STATUS',
      sqlSchemaProjectionId: 'PROJ-SQL-MISMATCHED-STATUS'
    });

    const statusFinding = findings.find(
      (f) => f.type === 'data-boundary-ambiguity' && f.rationale?.includes('OrderStatus')
    );
    expect(statusFinding).toBeDefined();
    expect(statusFinding?.rationale).toContain("OpenAPI declares entity schema 'OrderStatus'");
  });

  it('preserves true positive: flags required array when child table exists by name but has NO parent FK (AC-2, AC-3, F-219d7de5, F-b8f75bcb)', () => {
    const sql = `
      CREATE TABLE orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL
      );

      CREATE TABLE order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        quantity INT NOT NULL
      );
    `;
    const openApiDoc = {
      openapi: '3.1.0',
      components: {
        schemas: {
          Order: {
            type: 'object',
            properties: { id: { type: 'string' }, customer_id: { type: 'string' } }
          },
          OrderCreateRequest: {
            type: 'object',
            required: ['customer_id', 'items'],
            properties: {
              customer_id: { type: 'string', format: 'uuid' },
              items: {
                type: 'array',
                items: { $ref: '#/components/schemas/OrderItemCreateRequest' }
              }
            }
          },
          OrderItemCreateRequest: {
            type: 'object',
            required: ['quantity'],
            properties: {
              quantity: { type: 'integer' }
            }
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-UNLINKED-CHILD',
      sqlSchemaProjectionId: 'PROJ-SQL-UNLINKED-CHILD'
    });

    const itemsFinding = findings.find(
      (f) =>
        f.type === 'data-boundary-ambiguity' &&
        f.rationale?.includes("'items'") &&
        f.rationale?.includes('orders')
    );
    expect(itemsFinding).toBeDefined();
    expect(itemsFinding?.rationale).toContain(
      "OpenAPI contract requires field 'items', but column 'items' does not exist in SQL table 'orders'."
    );
  });

  it('preserves true positive: only parent ownership FK is skipped, distinct second FK to same parent is flagged (F-c9331e9c)', () => {
    const sql = `
      CREATE TABLE orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid()
      );

      CREATE TABLE order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id),
        previous_order_id UUID NOT NULL REFERENCES orders(id),
        quantity INT NOT NULL
      );
    `;
    const openApiDoc = {
      openapi: '3.1.0',
      components: {
        schemas: {
          Order: { type: 'object', properties: { id: { type: 'string' } } },
          OrderItemCreateRequest: {
            type: 'object',
            required: ['quantity'],
            properties: {
              quantity: { type: 'integer' }
              // previous_order_id is omitted!
            }
          }
        }
      }
    };

    const findings = validator.validate({
      openApiDoc,
      sqlSchemaContent: sql,
      baseline,
      openApiProjectionId: 'PROJ-OAS-MULTI-FK',
      sqlSchemaProjectionId: 'PROJ-SQL-MULTI-FK'
    });

    // order_id is parent lineage FK, so it should NOT be flagged
    const orderIdFinding = findings.find(
      (f) => f.rationale?.includes("'order_id'") && f.rationale?.includes('order_items')
    );
    expect(orderIdFinding).toBeUndefined();

    // previous_order_id is NOT parent lineage FK, so it MUST be flagged
    const prevOrderFinding = findings.find(
      (f) =>
        f.type === 'data-boundary-ambiguity' &&
        f.rationale?.includes("'previous_order_id'") &&
        f.rationale?.includes('order_items')
    );
    expect(prevOrderFinding).toBeDefined();
    expect(prevOrderFinding?.rationale).toContain(
      "SQL table 'order_items' defines mandatory column 'previous_order_id' (NOT NULL with no default), but field is missing from OpenAPI schema."
    );
  });

  it('correctly tests stripSqlComments without corrupting comments in quoted strings', () => {
    const sqlWithComments = `
      -- Line comment at start
      CREATE TABLE test (
        id UUID PRIMARY KEY, -- inline comment
        /* block comment */
        note VARCHAR(100) DEFAULT '-- not a comment --'
      );
    `;
    const stripped = stripSqlComments(sqlWithComments);
    expect(stripped).toContain("note VARCHAR(100) DEFAULT '-- not a comment --'");
    expect(stripped).not.toContain('Line comment at start');
    expect(stripped).not.toContain('inline comment');
    expect(stripped).not.toContain('block comment');
  });
});
