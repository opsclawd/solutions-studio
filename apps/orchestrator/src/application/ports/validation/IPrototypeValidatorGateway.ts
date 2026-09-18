export interface PrototypeValidationDetails {
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
  readonly snippet?: string;
}

export interface PrototypeValidationResult {
  readonly isValid: boolean;
  readonly errorMessage?: string;
  readonly errorDetails?: PrototypeValidationDetails;
}

export interface IPrototypeValidatorGateway {
  validate(tsxCode: string): Promise<PrototypeValidationResult>;
}
