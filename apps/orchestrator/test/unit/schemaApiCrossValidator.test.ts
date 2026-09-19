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
  hasForeignKeyToParent,
  detectTableRelationships,
  isParentTableView
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

  it('detectTableRelationships detects explicit, inferred, child, and association relationships', () => {
    const sql = `
      CREATE TABLE orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id VARCHAR(64) NOT NULL
      );

      CREATE TABLE products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sku VARCHAR(64) NOT NULL
      );

      CREATE TABLE order_line_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id),
        product_ref VARCHAR(64) NOT NULL,
        qty INTEGER NOT NULL
      );

      CREATE TABLE order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL,
        product_id UUID NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL
      );
    `;

    const tables = parseSqlTables(sql);
    const relationships = detectTableRelationships(tables);

    // order_line_items -> orders (explicit FK, isChildEntity: true)
    const lineItemToOrders = relationships.find(
      (r) => r.childTable === 'order_line_items' && r.parentTable === 'orders'
    );
    expect(lineItemToOrders).toBeDefined();
    expect(lineItemToOrders?.foreignKeyColumn).toBe('order_id');
    expect(lineItemToOrders?.referencedColumn).toBe('id');
    expect(lineItemToOrders?.isChildEntity).toBe(true);

    // order_items -> orders (inferred FK via order_id, isChildEntity: true)
    const itemToOrders = relationships.find(
      (r) => r.childTable === 'order_items' && r.parentTable === 'orders'
    );
    expect(itemToOrders).toBeDefined();
    expect(itemToOrders?.foreignKeyColumn).toBe('order_id');
    expect(itemToOrders?.isChildEntity).toBe(true);

    // order_items -> products (explicit FK via product_id, isChildEntity: false)
    const itemToProducts = relationships.find(
      (r) => r.childTable === 'order_items' && r.parentTable === 'products'
    );
    expect(itemToProducts).toBeDefined();
    expect(itemToProducts?.foreignKeyColumn).toBe('product_id');
    expect(itemToProducts?.isChildEntity).toBe(false);
  });

  it('does not emit unrelated relationships for generic parent_id across distinct candidate parent tables (F-02c39a73)', () => {
    const sql = `
      CREATE TABLE accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(128) NOT NULL
      );

      CREATE TABLE nodes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        parent_id UUID,
        title VARCHAR(128) NOT NULL
      );

      CREATE TABLE tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(32) NOT NULL
      );
    `;

    const tables = parseSqlTables(sql);
    const relationships = detectTableRelationships(tables);

    // nodes.parent_id must NOT be related to accounts or tenants
    const nodeToAccounts = relationships.find(
      (r) => r.childTable === 'nodes' && r.parentTable === 'accounts'
    );
    expect(nodeToAccounts).toBeUndefined();

    const nodeToTenants = relationships.find(
      (r) => r.childTable === 'nodes' && r.parentTable === 'tenants'
    );
    expect(nodeToTenants).toBeUndefined();

    // nodes.parent_id may be captured as self-reference on nodes
    const nodeSelfRef = relationships.find(
      (r) => r.childTable === 'nodes' && r.parentTable === 'nodes'
    );
    if (nodeSelfRef) {
      expect(nodeSelfRef.foreignKeyColumn).toBe('parent_id');
      expect(nodeSelfRef.isChildEntity).toBe(false);
    }
  });

  describe('Issue #86: Phase 3.12 remediation', () => {
    it('recognizes explicit FK child table without naming-convention prefix/suffix (Test 3.1)', () => {
      const sql = `
        CREATE TABLE orders (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_number VARCHAR(64) NOT NULL
        );

        CREATE TABLE payment_authorizations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_id UUID NOT NULL REFERENCES orders(id),
          authorized_amount NUMERIC(10, 2) NOT NULL
        );
      `;

      const tables = parseSqlTables(sql);
      const tableMap = new Map(tables.map((t) => [normalizeName(t.name), t]));
      const ordersTable = tableMap.get('order')!;
      const paymentAuthTable = tableMap.get('paymentauthorization')!;
      const orderIdCol = paymentAuthTable.columns.find((c) => c.name === 'order_id')!;

      // 1. isChildTableOf returns true due to explicit REFERENCES FK to orders
      expect(isChildTableOf(paymentAuthTable, ordersTable, tableMap)).toBe(true);

      // 2. isParentForeignKey returns true for order_id
      expect(isParentForeignKey(orderIdCol, paymentAuthTable, tableMap)).toBe(true);

      // 3. validator.validate does NOT flag order_id or payment_authorizations
      const openApiDoc = {
        openapi: '3.0.3',
        info: { title: 'Payment API', version: '1.0.0' },
        paths: {
          '/orders/{id}': {
            patch: {
              summary: 'Update order',
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/PaymentAuthorization'
                    }
                  }
                }
              },
              responses: { '200': { description: 'OK' } }
            }
          }
        },
        components: {
          schemas: {
            Order: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                order_number: { type: 'string' }
              },
              required: ['id', 'order_number']
            },
            PaymentAuthorization: {
              type: 'object',
              properties: {
                authorized_amount: { type: 'number' }
              },
              required: ['authorized_amount']
            }
          }
        }
      };

      const findings = validator.validate({
        openApiDoc,
        sqlSchemaContent: sql,
        baseline,
        openApiProjectionId: 'PROJ-OAS-86-1',
        sqlSchemaProjectionId: 'PROJ-SQL-86-1'
      });

      const missingColFindings = findings.filter(
        (f) => f.rationale?.includes('payment_authorizations') && f.rationale?.includes('order_id')
      );
      expect(missingColFindings).toHaveLength(0);
      expect(findings).toHaveLength(0);
    });

    it('matches hyphenated multi-word action path segments without state-transition annotations (Test 3.2)', () => {
      const sql = `
        CREATE TABLE orders (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_number VARCHAR(64) NOT NULL
        );
      `;

      const openApiDoc = {
        openapi: '3.0.3',
        info: { title: 'Orders API', version: '1.0.0' },
        paths: {
          '/orders/{id}/verify-payment': {
            post: {
              summary: 'Verify payment for order',
              responses: { '200': { description: 'OK' } }
            }
          },
          '/orders/{id}/process-refund': {
            post: {
              summary: 'Process refund for order',
              responses: { '200': { description: 'OK' } }
            }
          }
        },
        components: {
          schemas: {
            Order: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                order_number: { type: 'string' }
              },
              required: ['id', 'order_number']
            }
          }
        }
      };

      const findings = validator.validate({
        openApiDoc,
        sqlSchemaContent: sql,
        baseline,
        openApiProjectionId: 'PROJ-OAS-86-2',
        sqlSchemaProjectionId: 'PROJ-SQL-86-2'
      });

      const actionPathFindings = findings.filter(
        (f) =>
          f.type === 'data-boundary-ambiguity' &&
          (f.rationale?.includes('verify-payment') || f.rationale?.includes('process-refund'))
      );
      expect(actionPathFindings).toHaveLength(0);
      expect(findings).toHaveLength(0);
    });

    it('regression guard: secondary lookup FK with explicit parent FK is NOT exempted (Test 3.3a)', () => {
      const sql = `
        CREATE TABLE orders (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_number VARCHAR(64) NOT NULL
        );

        CREATE TABLE products (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          sku VARCHAR(64) NOT NULL
        );

        CREATE TABLE order_items (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_id UUID NOT NULL REFERENCES orders(id),
          product_id UUID NOT NULL REFERENCES products(id),
          quantity INT NOT NULL
        );
      `;

      const tables = parseSqlTables(sql);
      const tableMap = new Map(tables.map((t) => [normalizeName(t.name), t]));
      const ordersTable = tableMap.get('order')!;
      const productsTable = tableMap.get('product')!;
      const orderItemsTable = tableMap.get('orderitem')!;
      const orderIdCol = orderItemsTable.columns.find((c) => c.name === 'order_id')!;
      const productIdCol = orderItemsTable.columns.find((c) => c.name === 'product_id')!;

      // order_items is child of orders, but NOT child of products
      expect(isChildTableOf(orderItemsTable, ordersTable, tableMap)).toBe(true);
      expect(isChildTableOf(orderItemsTable, productsTable, tableMap)).toBe(false);

      // order_id IS parent FK, product_id is NOT parent FK
      expect(isParentForeignKey(orderIdCol, orderItemsTable, tableMap)).toBe(true);
      expect(isParentForeignKey(productIdCol, orderItemsTable, tableMap)).toBe(false);

      const openApiDoc = {
        openapi: '3.0.3',
        info: { title: 'Orders API', version: '1.0.0' },
        paths: {
          '/orders': {
            post: {
              summary: 'Create order',
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/Order'
                    }
                  }
                }
              },
              responses: { '201': { description: 'Created' } }
            }
          },
          '/order-items': {
            post: {
              summary: 'Create order item',
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/OrderItemCreateRequest'
                    }
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
              properties: {
                id: { type: 'string', format: 'uuid' },
                order_number: { type: 'string' }
              },
              required: ['id', 'order_number']
            },
            Product: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                sku: { type: 'string' }
              },
              required: ['id', 'sku']
            },
            OrderItemCreateRequest: {
              type: 'object',
              properties: {
                quantity: { type: 'integer' }
              },
              required: ['quantity']
            }
          }
        }
      };

      const findings = validator.validate({
        openApiDoc,
        sqlSchemaContent: sql,
        baseline,
        openApiProjectionId: 'PROJ-OAS-86-3a',
        sqlSchemaProjectionId: 'PROJ-SQL-86-3a'
      });

      // product_id MUST be flagged because it is missing from OpenAPI schema and is NOT a parent FK
      const productMissingFinding = findings.find(
        (f) => f.rationale?.includes('order_items') && f.rationale?.includes('product_id')
      );
      expect(productMissingFinding).toBeDefined();
      expect(productMissingFinding?.rationale).toContain(
        "SQL table 'order_items' defines mandatory column 'product_id' (NOT NULL with no default), but field is missing from OpenAPI schema."
      );

      // order_id must NOT be flagged because it is a parent FK
      const orderMissingFinding = findings.find(
        (f) => f.rationale?.includes('order_items') && f.rationale?.includes('order_id')
      );
      expect(orderMissingFinding).toBeUndefined();
    });

    it('regression guard: secondary lookup FK with inferred parent FK is NOT classified as child (Test 3.3b)', () => {
      const sql = `
        CREATE TABLE orders (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          customer_id VARCHAR(64) NOT NULL
        );

        CREATE TABLE products (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          sku VARCHAR(64) NOT NULL
        );

        CREATE TABLE order_items (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_id UUID NOT NULL,
          product_id UUID NOT NULL REFERENCES products(id),
          quantity INTEGER NOT NULL
        );
      `;

      const tables = parseSqlTables(sql);
      const tableMap = new Map(tables.map((t) => [normalizeName(t.name), t]));
      const productsTable = tableMap.get('product')!;
      const orderItemsTable = tableMap.get('orderitem')!;
      const productIdCol = orderItemsTable.columns.find((c) => c.name === 'product_id')!;

      // isChildTableOf must be false for products despite explicit FK because order_items is bound to orders
      expect(isChildTableOf(orderItemsTable, productsTable, tableMap)).toBe(false);
      expect(isParentForeignKey(productIdCol, orderItemsTable, tableMap)).toBe(false);

      const relationships = detectTableRelationships(tables);
      const itemToProducts = relationships.find(
        (r) => r.childTable === 'order_items' && r.parentTable === 'products'
      );
      expect(itemToProducts).toBeDefined();
      expect(itemToProducts?.foreignKeyColumn).toBe('product_id');
      expect(itemToProducts?.isChildEntity).toBe(false);

      const itemToOrders = relationships.find(
        (r) => r.childTable === 'order_items' && r.parentTable === 'orders'
      );
      expect(itemToOrders).toBeDefined();
      expect(itemToOrders?.foreignKeyColumn).toBe('order_id');
      expect(itemToOrders?.isChildEntity).toBe(true);
    });

    it('regression guard: genuine non-action multi-word path segment without backing table is flagged (Test 3.4)', () => {
      const sql = `
        CREATE TABLE orders (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_number VARCHAR(64) NOT NULL
        );
      `;

      const openApiDoc = {
        openapi: '3.0.3',
        info: { title: 'Orders API', version: '1.0.0' },
        paths: {
          '/orders/{id}/payment-methods': {
            get: {
              summary: 'Get payment methods for order',
              responses: { '200': { description: 'OK' } }
            }
          }
        },
        components: {
          schemas: {
            Order: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                order_number: { type: 'string' }
              },
              required: ['id', 'order_number']
            }
          }
        }
      };

      const findings = validator.validate({
        openApiDoc,
        sqlSchemaContent: sql,
        baseline,
        openApiProjectionId: 'PROJ-OAS-86-4',
        sqlSchemaProjectionId: 'PROJ-SQL-86-4'
      });

      const unbackedFinding = findings.find(
        (f) =>
          f.type === 'data-boundary-ambiguity' &&
          f.rationale?.includes('/orders/{id}/payment-methods') &&
          f.rationale?.includes("'payment-methods'")
      );
      expect(unbackedFinding).toBeDefined();
      expect(unbackedFinding?.rationale).toContain(
        "OpenAPI declares resource path '/orders/{id}/payment-methods' (resource 'payment-methods'), but no corresponding table exists in relational schema projection 'PROJ-SQL-86-4'."
      );
    });

    it('preserves downstream prompt grounding for independent root entities with FK (Test 3.5)', () => {
      const sql = `
        CREATE TABLE customer_accounts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          account_number VARCHAR(32) NOT NULL
        );

        CREATE TABLE orders (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          account_id UUID NOT NULL REFERENCES customer_accounts(id)
        );
      `;

      const tables = parseSqlTables(sql);
      const tableMap = new Map(tables.map((t) => [normalizeName(t.name), t]));
      const customerAccountsTable = tableMap.get('customeraccount')!;
      const ordersTable = tableMap.get('order')!;
      const accountIdCol = ordersTable.columns.find((c) => c.name === 'account_id')!;

      // orders is NOT a child of customer_accounts
      expect(isChildTableOf(ordersTable, customerAccountsTable, tableMap)).toBe(false);
      expect(isParentForeignKey(accountIdCol, ordersTable, tableMap)).toBe(false);

      const relationships = detectTableRelationships(tables);
      const ordersToAccounts = relationships.find(
        (r) => r.childTable === 'orders' && r.parentTable === 'customer_accounts'
      );
      expect(ordersToAccounts).toBeDefined();
      expect(ordersToAccounts?.foreignKeyColumn).toBe('account_id');
      expect(ordersToAccounts?.isChildEntity).toBe(false);
    });

    it('regression guard: explicitly differently referenced prefix-shaped column does NOT veto valid explicit parent FK (F-f87410d6, F-84d6d185)', () => {
      const sql = `
        CREATE TABLE orders (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_number VARCHAR(64) NOT NULL
        );

        CREATE TABLE payments (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          amount NUMERIC(10, 2) NOT NULL
        );

        CREATE TABLE invoices (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          invoice_number VARCHAR(64) NOT NULL
        );

        CREATE TABLE payment_authorizations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_id UUID NOT NULL REFERENCES orders(id),
          payment_id UUID NOT NULL REFERENCES invoices(id),
          authorized_amount NUMERIC(10, 2) NOT NULL
        );
      `;

      const tables = parseSqlTables(sql);
      const tableMap = new Map(tables.map((t) => [normalizeName(t.name), t]));
      const ordersTable = tableMap.get('order')!;
      const paymentsTable = tableMap.get('payment')!;
      const paymentAuthTable = tableMap.get('paymentauthorization')!;
      const orderIdCol = paymentAuthTable.columns.find((c) => c.name === 'order_id')!;
      const paymentIdCol = paymentAuthTable.columns.find((c) => c.name === 'payment_id')!;

      // payment_authorizations MUST be recognized as child of orders via explicit order_id REFERENCES orders(id)
      expect(isChildTableOf(paymentAuthTable, ordersTable, tableMap)).toBe(true);
      expect(isParentForeignKey(orderIdCol, paymentAuthTable, tableMap)).toBe(true);

      // payment_authorizations is NOT a child of payments (no FK to payments)
      expect(isChildTableOf(paymentAuthTable, paymentsTable, tableMap)).toBe(false);
      // payment_id references invoices, NOT payments, so it is not a parent FK to payments
      expect(isParentForeignKey(paymentIdCol, paymentAuthTable, tableMap)).toBe(false);

      // validator.validate does NOT flag order_id on payment_authorizations
      const openApiDoc = {
        openapi: '3.0.3',
        info: { title: 'Payment API', version: '1.0.0' },
        paths: {
          '/orders/{id}': {
            patch: {
              summary: 'Update order payment authorization',
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/PaymentAuthorization'
                    }
                  }
                }
              },
              responses: { '200': { description: 'OK' } }
            }
          }
        },
        components: {
          schemas: {
            PaymentAuthorization: {
              type: 'object',
              properties: {
                payment_id: { type: 'string', format: 'uuid' },
                authorized_amount: { type: 'number' }
              },
              required: ['payment_id', 'authorized_amount']
            }
          }
        }
      };

      const findings = validator.validate({
        openApiDoc,
        sqlSchemaContent: sql,
        baseline,
        openApiProjectionId: 'PROJ-OAS-86-5',
        sqlSchemaProjectionId: 'PROJ-SQL-86-5'
      });

      const orderMissingFinding = findings.find(
        (f) => f.rationale?.includes('payment_authorizations') && f.rationale?.includes('order_id')
      );
      expect(orderMissingFinding).toBeUndefined();
    });

    it('regression guard: self-referencing child with separate parent lineage FK is recognized as child of parent (F-f87410d6, F-84d6d185)', () => {
      const sql = `
        CREATE TABLE catalogs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(64) NOT NULL
        );

        CREATE TABLE categories (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          catalog_id UUID NOT NULL REFERENCES catalogs(id),
          parent_id UUID REFERENCES categories(id),
          name VARCHAR(64) NOT NULL
        );
      `;

      const tables = parseSqlTables(sql);
      const tableMap = new Map(tables.map((t) => [normalizeName(t.name), t]));
      const catalogsTable = tableMap.get('catalog')!;
      const categoriesTable = tableMap.get('category')!;
      const catalogIdCol = categoriesTable.columns.find((c) => c.name === 'catalog_id')!;
      const parentIdCol = categoriesTable.columns.find((c) => c.name === 'parent_id')!;

      // categories is child of catalogs via explicit catalog_id REFERENCES catalogs(id)
      expect(isChildTableOf(categoriesTable, catalogsTable, tableMap)).toBe(true);
      expect(isParentForeignKey(catalogIdCol, categoriesTable, tableMap)).toBe(true);

      // parent_id is self-reference, not parent FK to catalogs
      expect(isParentForeignKey(parentIdCol, categoriesTable, tableMap)).toBe(false);

      const relationships = detectTableRelationships(tables);
      const catToCatalogs = relationships.find(
        (r) => r.childTable === 'categories' && r.parentTable === 'catalogs'
      );
      expect(catToCatalogs).toBeDefined();
      expect(catToCatalogs?.foreignKeyColumn).toBe('catalog_id');
      expect(catToCatalogs?.isChildEntity).toBe(true);

      const catSelfRef = relationships.find(
        (r) => r.childTable === 'categories' && r.parentTable === 'categories'
      );
      expect(catSelfRef).toBeDefined();
      expect(catSelfRef?.foreignKeyColumn).toBe('parent_id');
      expect(catSelfRef?.isChildEntity).toBe(false);
    });
  });

  describe('Phase 3.13: bare-noun sub-resource path exemptions (#88)', () => {
    it('UT-3.13.1 (AC-1): bare-noun path segment touching existing parent-table columns produces no finding', () => {
      const sql = `
        CREATE TABLE orders (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_number VARCHAR(64) NOT NULL,
          payment_authorized BOOLEAN NOT NULL,
          payment_authorization_id VARCHAR(64)
        );
      `;

      const openApiDoc = {
        openapi: '3.0.3',
        info: { title: 'Order Payment API', version: '1.0.0' },
        paths: {
          '/orders/{id}/payment': {
            get: {
              summary: 'Get order payment status',
              responses: {
                '200': {
                  description: 'Payment status view',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: {
                          payment_authorized: { type: 'boolean' },
                          payment_authorization_id: { type: 'string' }
                        },
                        required: ['payment_authorized']
                      }
                    }
                  }
                }
              }
            },
            put: {
              summary: 'Update order payment status',
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        payment_authorized: { type: 'boolean' }
                      },
                      required: ['payment_authorized']
                    }
                  }
                }
              },
              responses: {
                '200': {
                  description: 'Updated payment status',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: {
                          payment_authorized: { type: 'boolean' }
                        }
                      }
                    }
                  }
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
        openApiProjectionId: 'PROJ-OAS-88-1',
        sqlSchemaProjectionId: 'PROJ-SQL-88-1'
      });

      const paymentFinding = findings.find(
        (f) => f.rationale?.includes('/orders/{id}/payment') || f.rationale?.includes("'payment'")
      );
      expect(paymentFinding).toBeUndefined();
    });

    it('UT-3.13.2 (AC-2): regression guard: bare-noun path segment referencing non-parent fields is flagged', () => {
      const sql = `
        CREATE TABLE orders (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_number VARCHAR(64) NOT NULL
        );
      `;

      const openApiDoc = {
        openapi: '3.0.3',
        info: { title: 'Order Invoices API', version: '1.0.0' },
        paths: {
          '/orders/{id}/invoice': {
            get: {
              summary: 'Get order invoice',
              responses: {
                '200': {
                  description: 'Invoice details',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: {
                          invoice_number: { type: 'string' },
                          tax_id: { type: 'string' },
                          due_date: { type: 'string', format: 'date' }
                        },
                        required: ['invoice_number']
                      }
                    }
                  }
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
        openApiProjectionId: 'PROJ-OAS-88-2',
        sqlSchemaProjectionId: 'PROJ-SQL-88-2'
      });

      const invoiceFinding = findings.find(
        (f) => f.rationale?.includes('/orders/{id}/invoice') || f.rationale?.includes("'invoice'")
      );
      expect(invoiceFinding).toBeDefined();
      expect(invoiceFinding?.type).toBe('data-boundary-ambiguity');
      expect(invoiceFinding?.rationale).toContain(
        "OpenAPI declares resource path '/orders/{id}/invoice' (resource 'invoice'), but no corresponding table exists in relational schema projection 'PROJ-SQL-88-2'."
      );
    });

    it('UT-3.13.2b (regression): bare-noun path /orders/{id}/invoice returning number is flagged when orders contains order_number', () => {
      const sql = `
        CREATE TABLE orders (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_number VARCHAR(64) NOT NULL
        );
      `;

      const openApiDoc = {
        openapi: '3.0.3',
        info: { title: 'Order Invoice Number Collision API', version: '1.0.0' },
        paths: {
          '/orders/{id}/invoice': {
            get: {
              summary: 'Get order invoice',
              responses: {
                '200': {
                  description: 'Invoice details with generic number property',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: {
                          number: { type: 'string' }
                        },
                        required: ['number']
                      }
                    }
                  }
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
        openApiProjectionId: 'PROJ-OAS-88-2b',
        sqlSchemaProjectionId: 'PROJ-SQL-88-2b'
      });

      const invoiceFinding = findings.find(
        (f) => f.rationale?.includes('/orders/{id}/invoice') || f.rationale?.includes("'invoice'")
      );
      expect(invoiceFinding).toBeDefined();
      expect(invoiceFinding?.type).toBe('data-boundary-ambiguity');
      expect(invoiceFinding?.rationale).toContain(
        "OpenAPI declares resource path '/orders/{id}/invoice' (resource 'invoice'), but no corresponding table exists in relational schema projection 'PROJ-SQL-88-2b'."
      );
    });

    it('UT-3.13.3: terminal-prefixed composite property matching matches parent columns', () => {
      const sql = `
        CREATE TABLE orders (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          payment_status VARCHAR(32) NOT NULL,
          payment_amount NUMERIC(10, 2) NOT NULL
        );
      `;

      const openApiDoc = {
        openapi: '3.0.3',
        info: { title: 'Order Payment Composite API', version: '1.0.0' },
        paths: {
          '/orders/{id}/payment': {
            get: {
              summary: 'Get payment status',
              responses: {
                '200': {
                  description: 'Payment summary',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: {
                          status: { type: 'string' },
                          amount: { type: 'number' }
                        }
                      }
                    }
                  }
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
        openApiProjectionId: 'PROJ-OAS-88-3',
        sqlSchemaProjectionId: 'PROJ-SQL-88-3'
      });

      const paymentFinding = findings.find(
        (f) => f.rationale?.includes('/orders/{id}/payment') || f.rationale?.includes("'payment'")
      );
      expect(paymentFinding).toBeUndefined();
    });

    it('UT-3.13.4: regression guard: schemaless bare-noun path is NOT exempted (non-empty guard protects Test 3.4)', () => {
      const sql = `
        CREATE TABLE orders (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_number VARCHAR(64) NOT NULL
        );
      `;

      const openApiDoc = {
        openapi: '3.0.3',
        info: { title: 'Order Tracking API', version: '1.0.0' },
        paths: {
          '/orders/{id}/tracking': {
            get: {
              summary: 'Get order tracking',
              responses: {
                '200': {
                  description: 'OK without schema body'
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
        openApiProjectionId: 'PROJ-OAS-88-4',
        sqlSchemaProjectionId: 'PROJ-SQL-88-4'
      });

      const trackingFinding = findings.find(
        (f) => f.rationale?.includes('/orders/{id}/tracking') || f.rationale?.includes("'tracking'")
      );
      expect(trackingFinding).toBeDefined();
      expect(trackingFinding?.type).toBe('data-boundary-ambiguity');
    });

    it('UT-3.13.5: partial property match with unbacked fields is flagged as data-boundary-ambiguity', () => {
      const sql = `
        CREATE TABLE orders (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          payment_authorized BOOLEAN NOT NULL
        );
      `;

      const openApiDoc = {
        openapi: '3.0.3',
        info: { title: 'Order Partial Payment API', version: '1.0.0' },
        paths: {
          '/orders/{id}/payment': {
            get: {
              summary: 'Get order payment',
              responses: {
                '200': {
                  description: 'OK',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: {
                          payment_authorized: { type: 'boolean' },
                          untracked_gateway_secret: { type: 'string' }
                        }
                      }
                    }
                  }
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
        openApiProjectionId: 'PROJ-OAS-88-5',
        sqlSchemaProjectionId: 'PROJ-SQL-88-5'
      });

      const paymentFinding = findings.find(
        (f) => f.rationale?.includes('/orders/{id}/payment') || f.rationale?.includes("'payment'")
      );
      expect(paymentFinding).toBeDefined();
      expect(paymentFinding?.type).toBe('data-boundary-ambiguity');
    });

    it('UT-3.13.6: array-wrapped sub-resource view via $ref produces no finding', () => {
      const sql = `
        CREATE TABLE orders (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          payment_authorized BOOLEAN NOT NULL,
          payment_authorization_id VARCHAR(64)
        );
      `;

      const openApiDoc = {
        openapi: '3.0.3',
        info: { title: 'Order Payment Array API', version: '1.0.0' },
        paths: {
          '/orders/{id}/payment': {
            get: {
              summary: 'Get order payment views',
              responses: {
                '200': {
                  description: 'Array of payment views',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'array',
                        items: {
                          $ref: '#/components/schemas/PaymentView'
                        }
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
            PaymentView: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                payment_authorized: { type: 'boolean' },
                payment_authorization_id: { type: 'string' }
              },
              required: ['id', 'payment_authorized']
            }
          }
        }
      };

      const findings = validator.validate({
        openApiDoc,
        sqlSchemaContent: sql,
        baseline,
        openApiProjectionId: 'PROJ-OAS-88-6',
        sqlSchemaProjectionId: 'PROJ-SQL-88-6'
      });

      const paymentFinding = findings.find(
        (f) => f.rationale?.includes('/orders/{id}/payment') || f.rationale?.includes("'payment'")
      );
      expect(paymentFinding).toBeUndefined();
    });

    it('UT-3.13.7: direct unit tests of isParentTableView helper behavior', () => {
      const sql = `
        CREATE TABLE orders (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_number VARCHAR(64) NOT NULL,
          payment_status VARCHAR(32) NOT NULL
        );
      `;
      const tables = parseSqlTables(sql);
      const ordersTable = tables[0];

      // 1. null / empty guards
      expect(isParentTableView(null, ordersTable, {})).toBe(false);
      expect(isParentTableView({}, null as any, {})).toBe(false);
      expect(isParentTableView('invalid', ordersTable, {})).toBe(false);

      // 2. error responses (4xx, 5xx) ignored, only 2xx inspected
      const errorOnlyPathItem = {
        get: {
          responses: {
            '400': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { error_code: { type: 'string' } }
                  }
                }
              }
            },
            '500': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { internal_message: { type: 'string' } }
                  }
                }
              }
            }
          }
        }
      };
      expect(isParentTableView(errorOnlyPathItem, ordersTable, {}, 'payment')).toBe(false);

      // 3. 2xx response alongside 4xx response: error response schema properties do NOT invalidate
      const mixedRespPathItem = {
        get: {
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { payment_status: { type: 'string' } }
                  }
                }
              }
            },
            '404': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { not_found_reason: { type: 'string' } }
                  }
                }
              }
            }
          }
        }
      };
      expect(isParentTableView(mixedRespPathItem, ordersTable, {}, 'payment')).toBe(true);

      // 4. terminal-named wrapper object unwrapping: { payment: { status: 'PAID' } }
      const wrappedPathItem = {
        get: {
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      payment: {
                        type: 'object',
                        properties: { status: { type: 'string' } }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      };
      expect(isParentTableView(wrappedPathItem, ordersTable, {}, 'payment')).toBe(true);

      // 5. parent identifier variants (id, order_id, parent_id)
      const surrogateKeyPathItem = {
        get: {
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      order_id: { type: 'string' },
                      payment_status: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        }
      };
      expect(isParentTableView(surrogateKeyPathItem, ordersTable, {}, 'payment')).toBe(true);

      // 6. root-prefixed property collision rejected (e.g. 'number' does NOT match 'order_number' for terminal 'invoice')
      const invoiceNumberPathItem = {
        get: {
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { number: { type: 'string' } }
                  }
                }
              }
            }
          }
        }
      };
      expect(isParentTableView(invoiceNumberPathItem, ordersTable, {}, 'invoice')).toBe(false);
    });
  });
});
