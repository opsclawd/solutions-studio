import { describe, it, expect } from 'vitest';
import { PGliteSqlValidatorAdapter } from '../../src/infrastructure/validation/PGliteSqlValidatorAdapter.js';

describe('PGliteSqlValidatorAdapter', () => {
  const adapter = new PGliteSqlValidatorAdapter();

  it('validates a correct PostgreSQL schema with tables, constraints, and indexes', async () => {
    const ddl = `
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE orders (
        id BIGSERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
        status TEXT NOT NULL DEFAULT 'PENDING',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX idx_orders_user_id ON orders(user_id);
    `;

    const result = await adapter.validate(ddl);
    expect(result.isValid).toBe(true);
    expect(result.errorMessage).toBeUndefined();
    expect(result.errorDetails).toBeUndefined();
  });

  it('fails when SQL code is empty or whitespace only', async () => {
    const resultEmpty = await adapter.validate('');
    expect(resultEmpty.isValid).toBe(false);
    expect(resultEmpty.errorMessage).toContain('cannot be empty');

    const resultWhitespace = await adapter.validate('   \n  \t  ');
    expect(resultWhitespace.isValid).toBe(false);
    expect(resultWhitespace.errorMessage).toContain('cannot be empty');
  });

  it('catches SQL syntax errors and returns diagnostic line and position details', async () => {
    const brokenSql = `
      CREATE TABL invalid_syntax (
        id INT
      );
    `;

    const result = await adapter.validate(brokenSql);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toBeDefined();
    expect(result.errorMessage).toMatch(/syntax error/i);
    expect(result.errorDetails).toBeDefined();
    expect(result.errorDetails?.position).toBeDefined();
  });

  it('catches foreign key constraint errors referencing non-existent tables', async () => {
    const invalidFkSql = `
      CREATE TABLE line_items (
        id SERIAL PRIMARY KEY,
        order_id INT REFERENCES non_existent_orders(id)
      );
    `;

    const result = await adapter.validate(invalidFkSql);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toBeDefined();
    expect(result.errorMessage).toMatch(/does not exist/i);
  });

  it('guarantees isolated execution between validation runs without cross-run schema leaks', async () => {
    const schemaA = `
      CREATE TABLE ephemeral_run_check (
        id INT PRIMARY KEY
      );
    `;

    // First run creates table
    const result1 = await adapter.validate(schemaA);
    expect(result1.isValid).toBe(true);

    // Second run: querying or referencing table from first run must fail because each run is fresh
    const queryNonExistent = `
      SELECT * FROM ephemeral_run_check;
    `;
    const result2 = await adapter.validate(queryNonExistent);
    expect(result2.isValid).toBe(false);
    expect(result2.errorMessage).toMatch(/relation "ephemeral_run_check" does not exist/i);
  });
});
