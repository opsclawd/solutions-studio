import type {
  IGenerationGateway,
  GenerationRequest,
  GenerationResult
} from '../../application/ports/generation/IGenerationGateway.js';

export class DeterministicFallbackGateway implements IGenerationGateway {
  private defaultResponse: string =
    'graph TD;\n  Start([Start Request]) --> Step1[Validate];\n  Step1 --> Complete([Complete]);';

  constructor(defaultResponse?: string) {
    if (defaultResponse) {
      this.defaultResponse = defaultResponse;
    }
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const isStateDiagram =
      request.prompt.toLowerCase().includes('state-diagram') ||
      request.prompt.toLowerCase().includes('state diagram');

    const text = isStateDiagram
      ? 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Processing: Submit\n  Processing --> Success: Complete\n  Success --> [*]'
      : this.defaultResponse;

    return {
      text,
      metadata: {
        provider: 'fake',
        model: 'deterministic-fallback',
        durationMs: 1
      }
    };
  }
}
