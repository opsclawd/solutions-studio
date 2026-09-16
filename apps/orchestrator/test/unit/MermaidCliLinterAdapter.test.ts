import { describe, it, expect } from 'vitest';
import { MermaidCliLinterAdapter } from '../../src/infrastructure/validation/MermaidCliLinterAdapter.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

describe('MermaidCliLinterAdapter', () => {
  const adapter = new MermaidCliLinterAdapter();

  it('validates a valid Mermaid flowchart fixture successfully', async () => {
    const fixturePath = path.resolve(
      process.cwd(),
      'test/fixtures/mermaid/valid-flowchart.mmd'
    );
    const validCode = await fs.readFile(fixturePath, 'utf-8');

    const result = await adapter.validate(validCode);
    expect(result.isValid).toBe(true);
    expect(result.errorMessage).toBeUndefined();
  }, 15_000);

  it('detects syntax error in an invalid Mermaid fixture and captures error message', async () => {
    const fixturePath = path.resolve(
      process.cwd(),
      'test/fixtures/mermaid/invalid-syntax.mmd'
    );
    const invalidCode = await fs.readFile(fixturePath, 'utf-8');

    const result = await adapter.validate(invalidCode);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toBeDefined();
    expect(result.errorMessage).toMatch(/Parse error/i);
  }, 15_000);

  it('fails fast on empty string', async () => {
    const result = await adapter.validate('   ');
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain('Empty Mermaid diagram');
  });
});
