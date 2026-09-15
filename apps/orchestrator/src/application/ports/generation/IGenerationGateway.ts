export interface GenerationRequest {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  timeoutMs?: number;
}

export interface GenerationMetadata {
  provider?: string;
  model?: string;
  durationMs?: number;
  tokens?: {
    input?: number;
    output?: number;
    thinking?: number;
    total?: number;
  };
  raw?: unknown;
}

export interface GenerationResult {
  text: string;
  metadata?: GenerationMetadata;
}

export interface IGenerationGateway {
  generate(request: GenerationRequest): Promise<GenerationResult>;
}
