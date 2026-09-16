/**
 * SandboxCompiler: In-browser transpilation for generated TSX/React prototypes using @babel/standalone.
 *
 * Security & Design Invariants:
 * - Operates purely on text/AST: does NOT execute or evaluate any code.
 * - Enforces module whitelist: only approved runtime modules (e.g. 'react', 'react-dom') may be imported.
 * - Generates structured error diagnostics (message, line, column) on syntax/type errors.
 */

import * as Babel from '@babel/standalone';

export interface CompileErrorDetails {
  message: string;
  line?: number;
  column?: number;
  snippet?: string;
  rawError?: string;
}

export interface CompileSuccess {
  success: true;
  code: string;
}

export interface CompileFailure {
  success: false;
  error: CompileErrorDetails;
}

export type CompileResult = CompileSuccess | CompileFailure;

export interface CompilerOptions {
  allowedModules?: string[];
  filename?: string;
}

export const DEFAULT_ALLOWED_MODULES = [
  'react',
  'react-dom',
  'react/jsx-runtime',
];

/**
 * Validates that all import statements in the source code target only whitelisted modules.
 * Returns an error message if an unapproved import is detected, or null if valid.
 */
export function validateImports(code: string, allowedModules: string[] = DEFAULT_ALLOWED_MODULES): string | null {
  // Matches: import ... from 'module' or import ... from "module"
  const importRegex = /import\s+(?:[\w\s{},*]*\s+from\s+)?['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(code)) !== null) {
    const importSource = match[1];
    if (!allowedModules.includes(importSource)) {
      return `Prohibited module import: '${importSource}'. Prototype sandbox only allows: [${allowedModules.join(', ')}].`;
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

/**
 * Transpiles TSX code to executable JavaScript targeting the sandbox runtime environment.
 */
export function compileTsx(sourceCode: string, options: CompilerOptions = {}): CompileResult {
  const trimmed = sourceCode.trim();
  if (!trimmed) {
    return {
      success: false,
      error: {
        message: 'Source code cannot be empty.',
      },
    };
  }

  // 1. Verify module imports against whitelist
  const allowed = options.allowedModules ?? DEFAULT_ALLOWED_MODULES;
  const importError = validateImports(trimmed, allowed);
  if (importError) {
    return {
      success: false,
      error: {
        message: importError,
      },
    };
  }

  // 2. Perform AST transpilation via Babel
  try {
    const transformed = Babel.transform(trimmed, {
      filename: options.filename ?? 'SandboxComponent.tsx',
      presets: [
        ['env', { modules: 'commonjs', targets: { esmodules: true } }],
        ['react', { runtime: 'classic' }],
        ['typescript', { isTSX: true, allExtensions: true }],
      ],
      compact: false,
    });

    if (!transformed.code) {
      return {
        success: false,
        error: {
          message: 'Babel transformation produced empty code.',
        },
      };
    }

    return {
      success: true,
      code: transformed.code,
    };
  } catch (err: unknown) {
    const babelErr = err as {
      message?: string;
      loc?: { line: number; column: number };
      codeFrame?: string;
    };

    let message = babelErr.message || String(err);
    // Strip Babel filename prefix like "SandboxComponent.tsx: "
    message = message.replace(/^SandboxComponent\.tsx:\s*/, '');

    return {
      success: false,
      error: {
        message,
        line: babelErr.loc?.line,
        column: babelErr.loc?.column,
        snippet: babelErr.codeFrame,
        rawError: String(err),
      },
    };
  }
}
