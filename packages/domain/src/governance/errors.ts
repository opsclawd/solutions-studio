export class HumanActorRequiredForApprovalError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'Approvals require an authenticated human actor. Automated agents and systems are not permitted to create promotion approvals.'
    );
    this.name = 'HumanActorRequiredForApprovalError';
  }
}

export class EmptyValidationArtifactsError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'Validation run must contain at least one validation artifact. Empty evidence sets cannot be approved.'
    );
    this.name = 'EmptyValidationArtifactsError';
  }
}

export class ValidationEvidenceMismatchError extends Error {
  constructor(
    public readonly expectedDigest: string,
    public readonly actualDigest: string,
    message?: string
  ) {
    super(
      message ??
        `Validation evidence digest mismatch: approval requires '${expectedDigest}', but current run produced '${actualDigest}'.`
    );
    this.name = 'ValidationEvidenceMismatchError';
  }
}

export class CandidateShaMismatchError extends Error {
  constructor(
    public readonly expectedSha: string,
    public readonly actualSha: string,
    message?: string
  ) {
    super(
      message ??
        `Candidate SHA mismatch: approval targets '${expectedSha}', but requested evaluation is for '${actualSha}'.`
    );
    this.name = 'CandidateShaMismatchError';
  }
}

export class UnknownValidationRunError extends Error {
  constructor(
    public readonly runId: string,
    message?: string
  ) {
    super(message ?? `Unknown validation run: '${runId}'.`);
    this.name = 'UnknownValidationRunError';
  }
}

export class UnknownGovernanceApprovalError extends Error {
  constructor(
    public readonly approvalId: string,
    message?: string
  ) {
    super(message ?? `Unknown governance approval: '${approvalId}'.`);
    this.name = 'UnknownGovernanceApprovalError';
  }
}

export class StaleGovernanceApprovalError extends Error {
  constructor(
    public readonly approvalId: string,
    public readonly reason: string,
    message?: string
  ) {
    super(
      message ?? `Governance approval '${approvalId}' is stale and cannot be applied: ${reason}.`
    );
    this.name = 'StaleGovernanceApprovalError';
  }
}

export class InvalidGovernanceApprovalStateError extends Error {
  constructor(
    public readonly approvalId: string,
    public readonly currentState: string,
    public readonly requestedAction: string,
    message?: string
  ) {
    super(
      message ??
        `Cannot perform '${requestedAction}' on governance approval '${approvalId}' in state '${currentState}'.`
    );
    this.name = 'InvalidGovernanceApprovalStateError';
  }
}

export class InvalidCandidateShaError extends Error {
  constructor(
    public readonly invalidValue: string,
    message?: string
  ) {
    super(
      message ??
        `Invalid candidate commit SHA '${invalidValue}'. Expected a hexadecimal string between 7 and 64 characters.`
    );
    this.name = 'InvalidCandidateShaError';
  }
}
