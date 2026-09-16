export interface MermaidValidationResult {
  isValid: boolean;
  errorMessage?: string;
}

export interface IMermaidLinterGateway {
  validate(mermaidCode: string): Promise<MermaidValidationResult>;
}
