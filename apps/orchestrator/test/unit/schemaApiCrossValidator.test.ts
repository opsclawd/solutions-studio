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
  normalizeName
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
});
