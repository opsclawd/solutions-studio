import type {
  IPrototypeValidatorGateway,
  PrototypeValidationResult
} from '../../src/application/ports/validation/IPrototypeValidatorGateway.js';

export class FakePrototypeValidatorGateway implements IPrototypeValidatorGateway {
  public validationCalls: string[] = [];
  private cannedResults: Map<string, PrototypeValidationResult> = new Map();
  private defaultResult: PrototypeValidationResult = { isValid: true };
  private failureQueue: { count: number; errorMessage: string } | null = null;

  setResultFor(codeSnippet: string, result: PrototypeValidationResult): void {
    this.cannedResults.set(codeSnippet.trim(), result);
  }

  setDefaultResult(result: PrototypeValidationResult): void {
    this.defaultResult = result;
  }

  failNextNTimes(count: number, errorMessage: string): void {
    this.failureQueue = { count, errorMessage };
  }

  async validate(tsxCode: string): Promise<PrototypeValidationResult> {
    const trimmed = tsxCode.trim();
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
