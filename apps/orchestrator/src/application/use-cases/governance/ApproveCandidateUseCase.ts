import {
  createCandidateApprovalRecord,
  createActorId,
  now,
  HumanActorRequiredForApprovalError,
  ValidationEvidenceMismatchError,
  CandidateShaMismatchError,
  UnknownValidationRunError,
  type ActiveCandidateApprovalRecord,
  type AuthenticatedActor,
  type GovernanceDecision
} from '@solutions-studio/domain';
import type { IRequirementsRepository } from '../../ports/persistence/IRequirementsRepository.js';
import type { IAuthorizationPolicy } from '../../ports/identity/IAuthorizationPolicy.js';
import {
  type ITelemetryRegistry,
  TelemetryProvider,
  OperationalLogger
} from '../../ports/observability/index.js';

export interface ApproveCandidateInput {
  readonly id?: string;
  readonly candidateSha: string;
  readonly validationRunId: string;
  readonly evidenceDigest: string;
  readonly decision: GovernanceDecision;
  readonly rationale: string;
  readonly supersedes?: string;
  readonly actor: AuthenticatedActor;
}

export class ApproveCandidateUseCase {
  constructor(
    private readonly repository: IRequirementsRepository,
    private readonly authorizer: IAuthorizationPolicy,
    private readonly telemetryRegistry: ITelemetryRegistry = TelemetryProvider.default
  ) {}

  async execute(input: ApproveCandidateInput): Promise<ActiveCandidateApprovalRecord> {
    const { actor } = input;

    try {
      // 1. Double-Defense: Enforce human actor requirement
      if (actor.actorType !== 'human') {
        this.telemetryRegistry.incrementCounter('solutions_studio_governance_failures_total', {
          reason: 'non_human_actor'
        });
        throw new HumanActorRequiredForApprovalError(
          `Actor '${actor.id}' of type '${actor.actorType}' is not permitted to create promotion approval records. Approvals require an authenticated human actor.`
        );
      }

      // 2. Authorize provider-neutral capability 'candidate:approve'
      this.authorizer.authorize(actor, 'candidate:approve');

      // 3. Retrieve validation run and verify candidate SHA & evidence digest linkage
      const validationRun = await this.repository.getValidationRun(input.validationRunId);
      if (!validationRun) {
        this.telemetryRegistry.incrementCounter('solutions_studio_governance_failures_total', {
          reason: 'unknown_validation_run'
        });
        throw new UnknownValidationRunError(input.validationRunId);
      }

      if (validationRun.candidateSha.toLowerCase() !== input.candidateSha.toLowerCase()) {
        this.telemetryRegistry.incrementCounter('solutions_studio_governance_failures_total', {
          reason: 'candidate_sha_mismatch'
        });
        throw new CandidateShaMismatchError(input.candidateSha, validationRun.candidateSha);
      }

      if (validationRun.evidenceDigest.toLowerCase() !== input.evidenceDigest.toLowerCase()) {
        this.telemetryRegistry.incrementCounter('solutions_studio_governance_failures_total', {
          reason: 'evidence_digest_mismatch'
        });
        throw new ValidationEvidenceMismatchError(
          validationRun.evidenceDigest,
          input.evidenceDigest
        );
      }

      // 4. Verify candidateSha has not had a subsequent validation run (must approve latest run)
      const latestRun = await this.repository.getLatestValidationRun(input.candidateSha);
      if (latestRun && latestRun.id !== input.validationRunId) {
        this.telemetryRegistry.incrementCounter('solutions_studio_governance_failures_total', {
          reason: 'stale_validation_run'
        });
        throw new ValidationEvidenceMismatchError(
          latestRun.evidenceDigest,
          input.evidenceDigest,
          `Cannot approve candidate using non-latest validation run '${input.validationRunId}'. Latest validation run for '${input.candidateSha}' is '${latestRun.id}'.`
        );
      }

      // 5. Construct new candidate approval record
      const approvalId = input.id ?? `APPR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const newApproval = createCandidateApprovalRecord({
        id: approvalId,
        candidateSha: input.candidateSha,
        validationRunId: validationRun.id,
        evidenceDigest: validationRun.evidenceDigest,
        decision: input.decision,
        actor: {
          id: createActorId(actor.id),
          name: actor.name,
          email: actor.email,
          actorType: 'human'
        },
        decidedAt: now(),
        rationale: input.rationale,
        supersedes: input.supersedes
      });

      // 6. Atomically persist approval and supersede prior active approval under OCC lock/transaction
      await this.repository.replaceGovernanceApproval(newApproval, input.supersedes);

      this.telemetryRegistry.incrementCounter('solutions_studio_governance_approvals_total', {
        decision: newApproval.decision,
        status: newApproval.status
      });

      OperationalLogger.log('governance.approval.recorded', {
        candidateSha: newApproval.candidateSha,
        validationRunId: newApproval.validationRunId,
        approvalId: newApproval.id,
        decision: newApproval.decision,
        actorId: newApproval.actor.id,
        supersedes: newApproval.supersedes
      });

      OperationalLogger.log('command.executed', {
        command: 'approve_candidate',
        entityId: newApproval.id,
        candidateSha: newApproval.candidateSha
      });

      return newApproval;
    } catch (err) {
      if (
        !(err instanceof HumanActorRequiredForApprovalError) &&
        !(err instanceof UnknownValidationRunError) &&
        !(err instanceof CandidateShaMismatchError) &&
        !(err instanceof ValidationEvidenceMismatchError)
      ) {
        this.telemetryRegistry.incrementCounter('solutions_studio_governance_failures_total', {
          reason: err instanceof Error ? err.constructor.name : 'unknown'
        });
      }
      throw err;
    }
  }
}
