export interface GherkinValidationErrorDetails {
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

export interface ParsedGherkinScenario {
  readonly id?: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly steps: readonly {
    readonly keyword: string;
    readonly text: string;
    readonly line?: number;
  }[];
  readonly declaredRequirementRevisionIds: readonly string[];
  readonly declaredPolicyConstraintRevisionIds?: readonly string[];
  readonly line?: number;
  readonly rawText?: string;
}

export interface ParsedGherkinDocument {
  readonly title: string;
  readonly narrative?: {
    readonly role: string;
    readonly feature: string;
    readonly benefit: string;
    readonly rawText?: string;
  };
  readonly tags: readonly string[];
  readonly headerComments: readonly string[];
  readonly declaredBaselineId?: string;
  readonly declaredRequirementRevisionIds: readonly string[];
  readonly declaredPolicyConstraintRevisionIds?: readonly string[];
  readonly declaredStoryDependencies?: readonly string[];
  readonly scenarios: readonly ParsedGherkinScenario[];
}

export interface GherkinValidationResult {
  readonly isValid: boolean;
  readonly errorMessage?: string;
  readonly errorDetails?: readonly GherkinValidationErrorDetails[];
  readonly parsedDocument?: ParsedGherkinDocument;
}

export interface IGherkinValidatorGateway {
  validate(gherkinText: string): Promise<GherkinValidationResult>;
}
