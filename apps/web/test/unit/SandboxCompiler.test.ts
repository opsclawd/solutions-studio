import { describe, it, expect } from 'vitest';
import { compileTsx, validateImports } from '../../src/features/prototype-sandbox/SandboxCompiler';

describe('SandboxCompiler', () => {
  it('successfully compiles valid TSX to JavaScript with React classic runtime', () => {
    const tsx = `
      import React, { useState } from 'react';

      export default function TestComponent() {
        const [value, setValue] = useState<number>(42);
        return <div className="p-4">Value is: {value}</div>;
      }
    `;

    const result = compileTsx(tsx);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.code).toContain('createElement');
      expect(result.code).toContain('exports.default = TestComponent');
      expect(result.code).toContain('require("react")');
    }
  });

  it('fails with structured error details when TSX contains syntax errors', () => {
    const brokenTsx = `
      import React from 'react';
      export default function Broken() {
        return (
          <div>
            <span>Unclosed tag
          </div>
        );
      }
    `;

    const result = compileTsx(brokenTsx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.line).toBeDefined();
      expect(result.error.column).toBeDefined();
      expect(result.error.message).toMatch(/Unterminated JSX contents|Expected corresponding JSX closing tag/i);
    }
  });

  it('rejects prohibited module imports not in the approved runtime whitelist', () => {
    const maliciousImportTsx = `
      import React from 'react';
      import axios from 'axios';

      export default function Malicious() {
        return <div>Test</div>;
      }
    `;

    const result = compileTsx(maliciousImportTsx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Prohibited module import: 'axios'");
      expect(result.error.message).toContain("Prototype sandbox only allows: [react, react-dom, react/jsx-runtime]");
    }
  });

  it('rejects dynamic import expressions', () => {
    const dynamicImportTsx = `
      import React from 'react';

      export default function Dynamic() {
        const load = () => import('evil-pkg');
        return <button onClick={load}>Load</button>;
      }
    `;

    const result = compileTsx(dynamicImportTsx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Dynamic import('evil-pkg') is strictly prohibited");
    }
  });

  it('handles empty source strings cleanly', () => {
    const result = compileTsx('   ');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe('Source code cannot be empty.');
    }
  });

  it('validateImports returns null for allowed imports', () => {
    const code = `
      import React, { useState, useEffect } from 'react';
      import ReactDOM from 'react-dom';
    `;
    expect(validateImports(code)).toBeNull();
  });
});
