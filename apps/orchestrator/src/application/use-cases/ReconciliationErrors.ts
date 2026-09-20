import type { CandidateFinding, FindingId, RequirementRevisionId } from '@solutions-studio/domain';
export { EmptyBaselineError, InvalidBaselineMembershipError } from '@solutions-studio/domain';

export class ReconciliationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnknownRequirementRevisionError extends ReconciliationError {
  constructor(
    public readonly revisionId: string,
    message?: string
  ) {
    super(message ?? `Unknown requirement revision: '${revisionId}'`);
  }
}

export class StaleRevisionTargetError extends ReconciliationError {
  constructor(
    public readonly revisionId: string,
    public readonly latestRevisionId: string,
    message?: string
  ) {
    super(
      message ??
        `Cannot reconcile stale revision '${revisionId}': latest revision is '${latestRevisionId}'`
    );
  }
}

export class InvalidTransitionError extends ReconciliationError {
  constructor(message: string) {
    super(message);
  }
}

export class AlreadyClearError extends ReconciliationError {
  constructor(
    public readonly revisionId: string,
    message?: string
  ) {
    super(message ?? `Requirement revision '${revisionId}' is already in resolutionState 'CLEAR'`);
  }
}

export class UnknownCandidateFindingError extends ReconciliationError {
  constructor(
    public readonly findingId: string,
    message?: string
  ) {
    super(message ?? `Unknown candidate finding: '${findingId}'`);
  }
}

export class RationaleRequiredError extends ReconciliationError {
  constructor(message = 'A non-empty rationale is required') {
    super(message);
  }
}

export class MissingRevisionAncestorError extends ReconciliationError {
  constructor(
    public readonly missingAncestorId: string,
    public readonly childRevisionId: string,
    message?: string
  ) {
    super(
      message ??
        `Missing ancestor revision '${missingAncestorId}' in lineage of '${childRevisionId}'`
    );
  }
}

export class RevisionLineageCycleError extends ReconciliationError {
  constructor(
    public readonly cycleRevisionId: string,
    message?: string
  ) {
    super(message ?? `Cycle detected in revision lineage at revision '${cycleRevisionId}'`);
  }
}

export interface BlockingFindingMatch {
  readonly finding: CandidateFinding;
  readonly id: FindingId;
  readonly type: CandidateFinding['type'];
  readonly disposition: CandidateFinding['disposition'];
  readonly affectedRequirementRevisions: readonly RequirementRevisionId[];
  readonly evidence: CandidateFinding['evidence'];
  readonly discoveredBy: CandidateFinding['discoveredBy'];
  readonly rationale?: string;
  readonly affectedRevisionId: RequirementRevisionId;
  readonly matchedRevisionId: RequirementRevisionId;
  readonly proposedRevisionId: RequirementRevisionId;
}

export class BlockedByOpenFindingsError extends ReconciliationError {
  constructor(
    public readonly blockingFindings: readonly BlockingFindingMatch[],
    message?: string
  ) {
    const summary = blockingFindings
      .map(
        (b) =>
          `Finding '${b.id}' (affecting '${b.matchedRevisionId}') blocks proposed revision '${b.proposedRevisionId}'`
      )
      .join('; ');
    super(
      message ??
        `Cannot create baseline: blocked by ${blockingFindings.length} open finding(s): ${summary}`
    );
  }
}

export class UnauditedRequirementRevisionError extends ReconciliationError {
  constructor(
    public readonly revisionId: string,
    message?: string
  ) {
    super(
      message ??
        `Cannot create baseline: requirement revision '${revisionId}' lacks required human acceptance audit history`
    );
  }
}

export class UnauditedFindingDispositionError extends ReconciliationError {
  constructor(
    public readonly findingId: string,
    public readonly disposition: string,
    message?: string
  ) {
    super(
      message ??
        `Cannot create baseline: finding '${findingId}' with disposition '${disposition}' lacks required matching reconciliation audit history`
    );
  }
}

export class UnknownRequirementsBaselineError extends ReconciliationError {
  constructor(
    public readonly baselineId: string,
    message?: string
  ) {
    super(message ?? `Unknown requirements baseline: '${baselineId}'`);
  }
}

export class UnknownPolicyConstraintRevisionError extends ReconciliationError {
  constructor(
    public readonly revisionId: string,
    message?: string
  ) {
    super(message ?? `Unknown policy constraint revision: '${revisionId}'`);
  }
}

export class UnknownEngineeringDecisionError extends ReconciliationError {
  constructor(
    public readonly decisionId: string,
    message?: string
  ) {
    super(message ?? `Unknown engineering decision: '${decisionId}'`);
  }
}

export class InvalidEngineeringDecisionStateError extends ReconciliationError {
  constructor(message: string) {
    super(message);
  }
}

export class OptimisticConcurrencyConflictError extends ReconciliationError {
  constructor(message: string) {
    super(message);
  }
}

export class FindingDispositionConflictError extends OptimisticConcurrencyConflictError {
  constructor(
    public readonly findingId: string,
    public readonly expectedDisposition: string,
    public readonly currentDisposition: string,
    message?: string
  ) {
    super(
      message ??
        `Concurrency conflict for finding '${findingId}': expected disposition '${expectedDisposition}', found '${currentDisposition}'`
    );
  }
}

export class RequirementRevisionConflictError extends OptimisticConcurrencyConflictError {
  constructor(
    public readonly requirementId: string,
    public readonly expectedRevisionId: string | undefined,
    public readonly currentRevisionId: string | undefined,
    message?: string
  ) {
    super(
      message ??
        `Concurrency conflict for requirement '${requirementId}': expected revision '${expectedRevisionId}', found '${currentRevisionId}'`
    );
  }
}
