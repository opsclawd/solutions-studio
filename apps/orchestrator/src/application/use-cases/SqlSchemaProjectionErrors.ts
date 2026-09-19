export { RepairRetryExhaustionError } from './RepairErrors.js';
export { UnknownEngineeringDecisionError } from './ReconciliationErrors.js';

export class SqlProvenanceValidationError extends Error {
  constructor(
    message: string,
    public readonly baselineId: string,
    public readonly invalidRequirementRevisionIds?: readonly string[],
    public readonly allowedRequirementRevisionIds?: readonly string[],
    public readonly invalidPolicyConstraintRevisionIds?: readonly string[],
    public readonly allowedPolicyConstraintRevisionIds?: readonly string[],
    public readonly invalidEngineeringDecisionIds?: readonly string[],
    public readonly allowedEngineeringDecisionIds?: readonly string[]
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnacceptedEngineeringDecisionError extends Error {
  constructor(
    public readonly decisionId: string,
    public readonly state: string,
    public readonly baselineId: string,
    message?: string
  ) {
    super(
      message ??
        `Engineering decision '${decisionId}' for baseline '${baselineId}' is in state '${state}', but must be 'ACCEPTED'`
    );
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SqlExecutionValidationError extends Error {
  constructor(
    message: string,
    public readonly errorDetails?: {
      readonly message: string;
      readonly line?: number;
      readonly position?: number;
      readonly statementIndex?: number;
    }
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
