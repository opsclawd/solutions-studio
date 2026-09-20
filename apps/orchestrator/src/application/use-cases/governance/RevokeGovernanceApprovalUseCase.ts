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

export interface RevokeGovernanceApprovalInput {
  readonly approvalId: string;
  readonly rationale: string;
  readonly actor: AuthenticatedActor;
}

export class RevokeGovernanceApprovalUseCase {
  constructor(
    private readonly repository: IRequirementsRepository,
    private readonly authorizer: IAuthorizationPolicy
  ) {}

  async execute(input: RevokeGovernanceApprovalInput): Promise<RevokedCandidateApprovalRecord> {
    const { actor } = input;

    // 1. Enforce human actor requirement
    if (actor.actorType !== 'human') {
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
      throw new UnknownGovernanceApprovalError(input.approvalId);
    }

    if (existing.status !== 'ACTIVE') {
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
    return revoked;
  }
}
