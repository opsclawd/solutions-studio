import * as Babel from '@babel/standalone';
import type {
  IPrototypeValidatorGateway,
  PrototypeValidationResult
} from '../../application/ports/validation/IPrototypeValidatorGateway.js';

export const DEFAULT_ALLOWED_MODULES = ['react', 'react-dom', 'react/jsx-runtime'];

export class BabelTsxValidatorAdapter implements IPrototypeValidatorGateway {
  constructor(private readonly allowedModules: string[] = DEFAULT_ALLOWED_MODULES) {}

  async validate(tsxCode: string): Promise<PrototypeValidationResult> {
    const trimmed = tsxCode.trim();
    if (!trimmed) {
      return {
        isValid: false,
        errorMessage: 'Source code cannot be empty.'
      };
    }

    // 1. Verify module imports against whitelist
    const importError = this.validateImports(trimmed);
    if (importError) {
      return {
        isValid: false,
        errorMessage: importError
      };
    }

    // 2. Perform AST transpilation via Babel
    try {
      const transformed = Babel.transform(trimmed, {
        filename: 'PrototypeComponent.tsx',
        presets: [
          ['env', { modules: 'commonjs', targets: { esmodules: true } }],
          ['react', { runtime: 'classic' }],
          ['typescript', { isTSX: true, allExtensions: true }]
        ],
        compact: false
      });

      if (!transformed.code) {
        return {
          isValid: false,
          errorMessage: 'Babel transformation produced empty code.'
        };
      }

      // 3. Verify component export: must provide a default export
      const hasDefaultExport =
        /\bexport\s+default\b/.test(trimmed) ||
        /\bexports\.default\s*=/.test(transformed.code) ||
        /\bmodule\.exports\s*=/.test(transformed.code);

      if (!hasDefaultExport) {
        return {
          isValid: false,
          errorMessage:
            "Prototype TSX must export a default component (e.g., 'export default function App() { ... }')."
        };
      }

      return {
        isValid: true
      };
    } catch (err: unknown) {
      const babelErr = err as {
        message?: string;
        loc?: { line: number; column: number };
        codeFrame?: string;
      };

      let message = babelErr.message || String(err);
      message = message.replace(/^PrototypeComponent\.tsx:\s*/, '');

      return {
        isValid: false,
        errorMessage: message,
        errorDetails: {
          message,
          line: babelErr.loc?.line,
          column: babelErr.loc?.column,
          snippet: babelErr.codeFrame
        }
      };
    }
  }

  private validateImports(code: string): string | null {
    // Matches: import ... from 'module' or import ... from "module"
    const importRegex = /import\s+(?:[\w\s{},*]*\s+from\s+)?['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;

    while ((match = importRegex.exec(code)) !== null) {
      const importSource = match[1];
      if (!this.allowedModules.includes(importSource)) {
        return `Prohibited module import: '${importSource}'. Prototype sandbox only allows: [${this.allowedModules.join(', ')}].`;
      }
    }

    // Matches dynamic imports: import('module')
    const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = dynamicImportRegex.exec(code)) !== null) {
      const importSource = match[1];
      return `Dynamic import('${importSource}') is strictly prohibited in the sandboxed prototype.`;
    }

    return null;
  }
}
