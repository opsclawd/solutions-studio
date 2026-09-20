import {
  revokeCandidateApprovalRecord,
  createActorId,
  HumanActorRequiredForApprovalError,
  UnknownGovernanceApprovalError,
  InvalidGovernanceApprovalStateError,
  type RevokedCandidateApprovalRecord,
  type AuthenticatedActor
} from '@solutions-studio/domain';
import type { IRequirementsRepository } from '../../ports/persistence/IRequirementsRepository.js';
import type { IAuthorizationPolicy } from '../../ports/identity/IAuthorizationPolicy.js';
import {
  type ITelemetryRegistry,
  TelemetryProvider,
  OperationalLogger
} from '../../ports/observability/index.js';

export interface RevokeGovernanceApprovalInput {
  readonly approvalId: string;
  readonly rationale: string;
  readonly actor: AuthenticatedActor;
}

export class RevokeGovernanceApprovalUseCase {
  constructor(
    private readonly repository: IRequirementsRepository,
    private readonly authorizer: IAuthorizationPolicy,
    private readonly telemetryRegistry: ITelemetryRegistry = TelemetryProvider.default
  ) {}

  async execute(input: RevokeGovernanceApprovalInput): Promise<RevokedCandidateApprovalRecord> {
    const { actor } = input;

    try {
      // 1. Enforce human actor requirement
      if (actor.actorType !== 'human') {
        this.telemetryRegistry.incrementCounter('solutions_studio_governance_failures_total', {
          reason: 'non_human_actor'
        });
        throw new HumanActorRequiredForApprovalError(
          `Actor '${actor.id}' of type '${actor.actorType}' cannot revoke approval records. Approvals require an authenticated human actor.`
        );
      }

      // 2. Authorize capability
      this.authorizer.authorize(actor, 'candidate:approve');

      if (!input.rationale || input.rationale.trim().length === 0) {
        throw new Error('Revocation rationale must not be empty.');
      }

      // 3. Retrieve existing approval
      const existing = await this.repository.getGovernanceApproval(input.approvalId);
      if (!existing) {
        this.telemetryRegistry.incrementCounter('solutions_studio_governance_failures_total', {
          reason: 'unknown_governance_approval'
        });
        throw new UnknownGovernanceApprovalError(input.approvalId);
      }

      if (existing.status !== 'ACTIVE') {
        this.telemetryRegistry.incrementCounter('solutions_studio_governance_failures_total', {
          reason: 'invalid_governance_approval_state'
        });
        throw new InvalidGovernanceApprovalStateError(existing.id, existing.status, 'revoke');
      }

      // 4. Construct revoked record
      const revoked = revokeCandidateApprovalRecord(
        existing,
        {
          id: createActorId(actor.id),
          name: actor.name,
          email: actor.email,
          actorType: 'human'
        },
        input.rationale
      );

      // 5. Update under OCC (verifying current status is ACTIVE)
      await this.repository.updateGovernanceApproval(revoked, 'ACTIVE');

      this.telemetryRegistry.incrementCounter('solutions_studio_governance_approvals_total', {
        decision: revoked.decision,
        status: revoked.status
      });

      OperationalLogger.log('governance.approval.recorded', {
        candidateSha: revoked.candidateSha,
        validationRunId: revoked.validationRunId,
        approvalId: revoked.id,
        decision: revoked.decision,
        actorId: revoked.revocation.revokedBy.id,
        supersedes: revoked.supersedes
      });

      OperationalLogger.log('command.executed', {
        command: 'revoke_approval',
        entityId: revoked.id,
        candidateSha: revoked.candidateSha
      });

      return revoked;
    } catch (err) {
      if (
        !(err instanceof HumanActorRequiredForApprovalError) &&
        !(err instanceof UnknownGovernanceApprovalError) &&
        !(err instanceof InvalidGovernanceApprovalStateError)
      ) {
        this.telemetryRegistry.incrementCounter('solutions_studio_governance_failures_total', {
          reason: err instanceof Error ? err.constructor.name : 'unknown'
        });
      }
      throw err;
    }
  }
}
