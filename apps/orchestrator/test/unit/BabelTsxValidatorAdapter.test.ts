import { describe, it, expect } from 'vitest';
import { BabelTsxValidatorAdapter } from '../../src/infrastructure/validation/BabelTsxValidatorAdapter.js';

describe('BabelTsxValidatorAdapter', () => {
  const adapter = new BabelTsxValidatorAdapter();

  it('validates a correct React functional component with hooks and Tailwind classes', async () => {
    const code = `
      import React, { useState } from 'react';

      export default function TestComponent() {
        const [count, setCount] = useState<number>(0);
        return (
          <div className="p-4 bg-gray-50 border rounded-lg">
            <h1 className="text-sm font-bold text-gray-800">Counter: {count}</h1>
            <button
              onClick={() => setCount((c) => c + 1)}
              className="mt-2 px-3 py-1 bg-blue-600 text-white rounded text-xs"
            >
              Increment
            </button>
          </div>
        );
      }
    `;

    const result = await adapter.validate(code);
    expect(result.isValid).toBe(true);
    expect(result.errorMessage).toBeUndefined();
  });

  it('fails when code is empty or whitespace only', async () => {
    const resultEmpty = await adapter.validate('');
    expect(resultEmpty.isValid).toBe(false);
    expect(resultEmpty.errorMessage).toContain('cannot be empty');

    const resultWhitespace = await adapter.validate('   \n  \t  ');
    expect(resultWhitespace.isValid).toBe(false);
    expect(resultWhitespace.errorMessage).toContain('cannot be empty');
  });

  it('catches TSX syntax errors and returns line and column diagnostics', async () => {
    const brokenCode = `
      import React from 'react';

      export default function BrokenComponent() {
        return (
          <div>
            <span>Unclosed tag
          </div>
        );
      }
    `;

    const result = await adapter.validate(brokenCode);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toBeDefined();
    expect(result.errorDetails).toBeDefined();
    expect(result.errorDetails?.line).toBeDefined();
  });

  it('rejects prohibited module imports not in the whitelist', async () => {
    const prohibitedCode = `
      import React from 'react';
      import axios from 'axios';

      export default function AxiosComponent() {
        return <div>Test</div>;
      }
    `;

    const result = await adapter.validate(prohibitedCode);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain("Prohibited module import: 'axios'");
    expect(result.errorMessage).toContain(
      'Prototype sandbox only allows: [react, react-dom, react/jsx-runtime]'
    );
  });

  it('rejects dynamic import(...) calls', async () => {
    const dynamicCode = `
      import React, { useEffect } from 'react';

      export default function DynamicComponent() {
        useEffect(() => {
          import('some-module').then(console.log);
        }, []);
        return <div>Dynamic</div>;
      }
    `;

    const result = await adapter.validate(dynamicCode);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain("Dynamic import('some-module') is strictly prohibited");
  });

  it('rejects code that does not have a default export', async () => {
    const noExportCode = `
      import React from 'react';

      function InternalComponent() {
        return <div>Internal</div>;
      }
    `;

    const result = await adapter.validate(noExportCode);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain('must export a default component');
  });
});
