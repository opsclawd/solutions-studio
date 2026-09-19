import { PGlite } from '@electric-sql/pglite';
import type {
  ISqlValidatorGateway,
  SqlValidationResult
} from '../../application/ports/validation/ISqlValidatorGateway.js';

export class PGliteSqlValidatorAdapter implements ISqlValidatorGateway {
  async validate(sqlCode: string): Promise<SqlValidationResult> {
    const trimmed = sqlCode.trim();
    if (!trimmed) {
      return {
        isValid: false,
        errorMessage: 'SQL script cannot be empty.'
      };
    }

    let db: PGlite | undefined;
    try {
      db = new PGlite();
      await db.exec(trimmed);
      return { isValid: true };
    } catch (err: unknown) {
      const error = err as {
        message?: string;
        line?: number;
        position?: number | string;
        detail?: string;
        hint?: string;
      };

      const message = error.message ?? String(err);
      const positionNum =
        typeof error.position === 'number'
          ? error.position
          : typeof error.position === 'string'
            ? parseInt(error.position, 10)
            : undefined;

      let calculatedLine: number | undefined;
      if (positionNum && positionNum > 0) {
        calculatedLine = trimmed.slice(0, positionNum - 1).split('\n').length;
      }

      return {
        isValid: false,
        errorMessage: message,
        errorDetails: {
          message,
          line: calculatedLine ?? (typeof error.line === 'number' ? error.line : undefined),
          position: positionNum
        }
      };
    } finally {
      if (db) {
        try {
          await db.close();
        } catch {
          // Ignore close errors
        }
      }
    }
  }
}
