import type {
  IGenerationGateway,
  GenerationRequest,
  GenerationResult
} from '../../src/application/ports/generation/IGenerationGateway.js';

export type ScriptedResponse =
  | { type: 'success'; text: string; metadata?: GenerationResult['metadata'] }
  | { type: 'error'; error: Error };

export class FakeGenerationGateway implements IGenerationGateway {
  public recordedRequests: GenerationRequest[] = [];
  private responseQueue: ScriptedResponse[] = [];
  private defaultResponse: ScriptedResponse = {
    type: 'success',
    text: 'graph TD;\n  A[Start] --> B[Finish];'
  };

  constructor(initialResponses?: (string | ScriptedResponse)[]) {
    if (initialResponses) {
      for (const item of initialResponses) {
        if (typeof item === 'string') {
          this.queueResponse(item);
        } else {
          this.queueScriptedResponse(item);
        }
      }
    }
  }

  queueResponse(text: string, metadata?: GenerationResult['metadata']): void {
    this.responseQueue.push({ type: 'success', text, metadata });
  }

  queueError(error: Error): void {
    this.responseQueue.push({ type: 'error', error });
  }

  queueScriptedResponse(response: ScriptedResponse): void {
    this.responseQueue.push(response);
  }

  setDefaultResponse(text: string): void {
    this.defaultResponse = { type: 'success', text };
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    this.recordedRequests.push(request);

    const nextResponse = this.responseQueue.shift() ?? this.defaultResponse;

    if (nextResponse.type === 'error') {
      throw nextResponse.error;
    }

    return {
      text: nextResponse.text,
      metadata: nextResponse.metadata ?? {
        provider: 'fake',
        durationMs: 5,
        tokens: { input: 10, output: 20, total: 30 }
      }
    };
  }

  reset(): void {
    this.recordedRequests = [];
    this.responseQueue = [];
  }
}
