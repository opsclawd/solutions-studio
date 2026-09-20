import YAML from 'yaml';
import type {
  IOpenApiValidatorGateway,
  OpenApiValidationResult
} from '../../src/application/ports/validation/IOpenApiValidatorGateway.js';

export class FakeOpenApiValidatorGateway implements IOpenApiValidatorGateway {
  public validationCalls: string[] = [];
  private cannedResults: Map<string, OpenApiValidationResult> = new Map();
  private defaultResult: OpenApiValidationResult = { isValid: true };
  private failureQueue: { count: number; errorMessage: string } | null = null;

  setResultFor(codeSnippet: string, result: OpenApiValidationResult): void {
    this.cannedResults.set(codeSnippet.trim(), result);
  }

  setDefaultResult(result: OpenApiValidationResult): void {
    this.defaultResult = result;
  }

  failNextNTimes(count: number, errorMessage: string): void {
    this.failureQueue = { count, errorMessage };
  }

  async validate(openApiContent: string): Promise<OpenApiValidationResult> {
    const trimmed = openApiContent.trim();
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

    let baseResult = this.defaultResult;
    for (const [key, result] of this.cannedResults.entries()) {
      if (trimmed.includes(key) || key.includes(trimmed)) {
        baseResult = result;
        break;
      }
    }

    if (baseResult.isValid && !baseResult.parsedDocument) {
      try {
        const doc = YAML.parseDocument(trimmed);
        const parsed = doc.toJS();
        if (parsed && typeof parsed === 'object') {
          return {
            ...baseResult,
            parsedDocument: parsed as Record<string, unknown>
          };
        }
      } catch {
        // ignore
      }
    }

    return baseResult;
  }

  reset(): void {
    this.validationCalls = [];
    this.cannedResults.clear();
    this.defaultResult = { isValid: true };
    this.failureQueue = null;
  }
}
