export interface OpenApiValidationErrorDetails {
  readonly message: string;
  readonly path?: string;
  readonly line?: number;
  readonly column?: number;
  readonly rule?: string;
}

export interface OpenApiValidationResult {
  readonly isValid: boolean;
  readonly errorMessage?: string;
  readonly errorDetails?: readonly OpenApiValidationErrorDetails[];
  readonly parsedDocument?: Record<string, unknown>;
}

export interface IOpenApiValidatorGateway {
  validate(openApiContent: string): Promise<OpenApiValidationResult>;
}
