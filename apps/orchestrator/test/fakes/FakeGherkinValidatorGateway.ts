import type {
  IGherkinValidatorGateway,
  GherkinValidationResult
} from '../../src/application/ports/validation/IGherkinValidatorGateway.js';
import { GherkinValidatorAdapter } from '../../src/infrastructure/validation/GherkinValidatorAdapter.js';

export class FakeGherkinValidatorGateway implements IGherkinValidatorGateway {
  public validationCalls: string[] = [];
  private readonly realValidator = new GherkinValidatorAdapter();
  private cannedResults: Map<string, GherkinValidationResult> = new Map();
  private defaultResult: GherkinValidationResult | null = null;
  private failureQueue: { count: number; errorMessage: string } | null = null;

  setResultFor(codeSnippet: string, result: GherkinValidationResult): void {
    this.cannedResults.set(codeSnippet.trim(), result);
  }

  setDefaultResult(result: GherkinValidationResult | null): void {
    this.defaultResult = result;
  }

  failNextNTimes(count: number, errorMessage: string): void {
    this.failureQueue = { count, errorMessage };
  }

  async validate(gherkinText: string): Promise<GherkinValidationResult> {
    const trimmed = gherkinText.trim();
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
        errorDetails: [{ message: msg }]
      };
    }

    for (const [key, result] of this.cannedResults.entries()) {
      if (trimmed.includes(key) || key.includes(trimmed)) {
        return result;
      }
    }

    if (this.defaultResult !== null) {
      return this.defaultResult;
    }

    return this.realValidator.validate(gherkinText);
  }

  reset(): void {
    this.validationCalls = [];
    this.cannedResults.clear();
    this.defaultResult = null;
    this.failureQueue = null;
  }
}
