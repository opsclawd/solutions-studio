export interface BaselineMembershipViolation<TRevisionId = string, TRequirementId = string> {
  readonly revisionId: TRevisionId;
  readonly requirementId: TRequirementId;
  readonly reasons: readonly string[];
}

export class DomainError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class EmptyIdentifierError extends DomainError {
  constructor(public readonly identifierType: string) {
    super(`Identifier for '${identifierType}' must be a non-empty string`);
  }
}

export class InvalidInstantError extends DomainError {
  constructor(public readonly value: string) {
    super(`Invalid ISO-8601 instant string: '${value}'`);
  }
}

export class InvalidRevisionNumberError extends DomainError {
  constructor(public readonly revision: number) {
    super(`Revision number must be an integer >= 1, received: ${revision}`);
  }
}

export class FindingRationaleRequiredError extends DomainError {
  constructor(public readonly disposition: string) {
    super(`An auditable rationale is required when transitioning a finding to '${disposition}'`);
  }
}

export class InvalidBaselineMembershipError extends DomainError {
  constructor(public readonly violations: readonly BaselineMembershipViolation[]) {
    const summary = violations.map((v) => `${v.revisionId}: ${v.reasons.join(', ')}`).join('; ');
    super(
      `Cannot create requirements baseline: ${violations.length} requirement revision(s) are invalid: ${summary}`
    );
  }
}

export class EmptyBaselineError extends DomainError {
  constructor(
    message = 'Cannot create requirements baseline: requirements list must not be empty'
  ) {
    super(message);
  }
}
