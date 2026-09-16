import {
  IMermaidLinterGateway,
  MermaidValidationResult,
} from '../../src/application/ports/validation/IMermaidLinterGateway.js';

export class FakeMermaidLinterGateway implements IMermaidLinterGateway {
  public validationCalls: string[] = [];
  private cannedResults: Map<string, MermaidValidationResult> = new Map();
  private defaultResult: MermaidValidationResult = { isValid: true };

  setResultFor(codeSnippet: string, result: MermaidValidationResult): void {
    this.cannedResults.set(codeSnippet.trim(), result);
  }

  setDefaultResult(result: MermaidValidationResult): void {
    this.defaultResult = result;
  }

  async validate(mermaidCode: string): Promise<MermaidValidationResult> {
    const trimmed = mermaidCode.trim();
    this.validationCalls.push(trimmed);

    for (const [key, result] of this.cannedResults.entries()) {
      if (trimmed.includes(key) || key.includes(trimmed)) {
        return result;
      }
    }

    // Default simple heuristic for tests: if it has "-->\n" or ends with "-->", it's invalid syntax
    if (/-->\s*($|\n|;)/.test(trimmed)) {
      return {
        isValid: false,
        errorMessage: 'Parse error on line: missing target node for arrow',
      };
    }

    return this.defaultResult;
  }

  reset(): void {
    this.validationCalls = [];
    this.cannedResults.clear();
  }
}
