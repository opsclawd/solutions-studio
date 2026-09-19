import type {
  ISqlValidatorGateway,
  SqlValidationResult
} from '../../src/application/ports/validation/ISqlValidatorGateway.js';

export class FakeSqlValidatorGateway implements ISqlValidatorGateway {
  public validationCalls: string[] = [];
  private cannedResults: Map<string, SqlValidationResult> = new Map();
  private defaultResult: SqlValidationResult = { isValid: true };
  private failureQueue: { count: number; errorMessage: string } | null = null;

  setResultFor(codeSnippet: string, result: SqlValidationResult): void {
    this.cannedResults.set(codeSnippet.trim(), result);
  }

  setDefaultResult(result: SqlValidationResult): void {
    this.defaultResult = result;
  }

  failNextNTimes(count: number, errorMessage: string): void {
    this.failureQueue = { count, errorMessage };
  }

  async validate(sqlCode: string): Promise<SqlValidationResult> {
    const trimmed = sqlCode.trim();
    this.validationCalls.push(trimmed);

    if (this.failureQueue && this.failureQueue.count > 0) {
      this.failureQueue.count--;
      const msg = this.failureQueue.errorMessage;
      if (this.failureQueue.count === 0) {
        this.failureQueue = null;
      }
      return {
        isValid: false,
        errorMessage: msg,
        errorDetails: { message: msg }
      };
    }

    for (const [key, result] of this.cannedResults.entries()) {
      if (trimmed.includes(key) || key.includes(trimmed)) {
        return result;
      }
    }

    return this.defaultResult;
  }

  reset(): void {
    this.validationCalls = [];
    this.cannedResults.clear();
    this.defaultResult = { isValid: true };
    this.failureQueue = null;
  }
}
