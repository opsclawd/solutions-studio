export interface SqlValidationErrorDetails {
  readonly message: string;
  readonly line?: number;
  readonly position?: number;
  readonly statementIndex?: number;
}

export interface SqlValidationResult {
  readonly isValid: boolean;
  readonly errorMessage?: string;
  readonly errorDetails?: SqlValidationErrorDetails;
}

export interface ISqlValidatorGateway {
  validate(sqlCode: string): Promise<SqlValidationResult>;
}
