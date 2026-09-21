import { randomUUID } from 'node:crypto';
import {
  createRequirementRevisionId,
  createActorId,
  createRequirementId,
  createFindingId,
  now,
  reviseRequirement,
  resolveFinding,
  dismissAsFalsePositive,
  acceptRisk,
  reopenFinding as domainReopenFinding,
  FindingRationaleRequiredError,
  type RequirementRevision,
  type CandidateFinding,
  type RequirementRevisionId,
  type FindingId,
  type ActorId,
  type RequirementId,
  type RequirementCategory,
  type RequirementOrigin,
  type RequirementReviewState,
  type RequirementResolutionState,
  type FindingDisposition,
  type EvidenceReference
} from '@solutions-studio/domain';
import type { IRequirementsRepository } from '../ports/persistence/IRequirementsRepository.js';
import {
  AlreadyClearError,
  InvalidTransitionError,
  RationaleRequiredError,
  StaleRevisionTargetError,
  UnknownCandidateFindingError,
  UnknownRequirementRevisionError
} from './ReconciliationErrors.js';
import { OperationalLogger } from '../ports/observability/index.js';

export interface AcceptRequirementInput {
  readonly revisionId: RequirementRevisionId | string;
  readonly rationale: string;
  readonly actorId?: ActorId | string;
  readonly newRevisionId?: RequirementRevisionId | string;
}

export interface RejectRequirementInput {
  readonly revisionId: RequirementRevisionId | string;
  readonly rationale: string;
  readonly actorId?: ActorId | string;
  readonly newRevisionId?: RequirementRevisionId | string;
}

export interface ReviseRequirementInput {
  readonly revisionId: RequirementRevisionId | string;
  readonly statement?: string;
  readonly category?: RequirementCategory;
  readonly origin?: RequirementOrigin;
  readonly evidence?: readonly EvidenceReference[];
  readonly affectedActors?: readonly (ActorId | string)[];
  readonly dependencies?: readonly (RequirementId | string)[];
  readonly rationale: string;
  readonly actorId?: ActorId | string;
  readonly newRevisionId?: RequirementRevisionId | string;
}

export interface ResolveRequirementInput {
  readonly revisionId: RequirementRevisionId | string;
  readonly rationale: string;
  readonly actorId?: ActorId | string;
  readonly newRevisionId?: RequirementRevisionId | string;
}

export interface DispositionFindingInput {
  readonly findingId: FindingId | string;
  readonly disposition: FindingDisposition;
  readonly rationale: string;
  readonly actorId?: ActorId | string;
}

export interface ReopenFindingInput {
  readonly findingId: FindingId | string;
  readonly rationale?: string;
  readonly actorId?: ActorId | string;
}

function stringArraysEqual(a?: readonly string[], b?: readonly string[]): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, idx) => val === sortedB[idx]);
}

function evidenceEqual(
  a?: readonly EvidenceReference[],
  b?: readonly EvidenceReference[]
): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  return a.every((refA, idx) => {
    const refB = b[idx];
    return (
      refB !== undefined &&
      refA.sourceRevisionId === refB.sourceRevisionId &&
      refA.locator === refB.locator
    );
  });
}

export class ReconcileRequirementsUseCase {
  constructor(private readonly repository: IRequirementsRepository) {}

  private assertNonEmptyRationale(rationale: unknown, action: string): string {
    if (typeof rationale !== 'string' || rationale.trim().length === 0) {
      throw new RationaleRequiredError(`A non-empty rationale is required to ${action}`);
    }
    return rationale.trim();
  }

  private async assertLatestRevision(target: RequirementRevision): Promise<void> {
    const revisions = await this.repository.listRequirementRevisions(target.requirementId);
    if (revisions.length > 0) {
      const latest = revisions[revisions.length - 1];
      if (latest.id !== target.id) {
        throw new StaleRevisionTargetError(target.id, latest.id);
      }
    }
  }

  async acceptRequirement(input: AcceptRequirementInput): Promise<RequirementRevision> {
    const trimmedRationale = this.assertNonEmptyRationale(input.rationale, 'accept a requirement');
    const revId = createRequirementRevisionId(input.revisionId);
    const target = await this.repository.getRequirementRevision(revId);
    if (!target) {
      throw new UnknownRequirementRevisionError(revId);
    }

    await this.assertLatestRevision(target);

    if (target.reviewState !== 'PENDING') {
      throw new InvalidTransitionError(
        `Cannot accept requirement with reviewState '${target.reviewState}': only PENDING requirements may be accepted`
      );
    }

    const successorId = input.newRevisionId
      ? createRequirementRevisionId(input.newRevisionId)
      : createRequirementRevisionId(`${target.requirementId}-R${target.revision + 1}`);

    const successor = reviseRequirement(target, {
      id: successorId,
      reviewState: 'ACCEPTED',
      rationale: trimmedRationale
    });

    const history = await this.repository.listReconciliationRecords(
      'requirement',
      target.requirementId
    );
    const prevReview =
      history.length === 0 ? undefined : history[history.length - 1].newReviewState;

    await this.repository.transitionRequirementRevision(
      successor,
      {
        id: randomUUID(),
        entityType: 'requirement',
        entityId: target.requirementId,
        requirementRevisionId: successor.id,
        action: 'ACCEPT',
        previousReviewState: prevReview,
        newReviewState: 'ACCEPTED',
        rationale: trimmedRationale,
        actorId: input.actorId ? createActorId(input.actorId) : undefined,
        recordedAt: now()
      },
      target.id
    );

    OperationalLogger.log('command.executed', {
      command: 'accept_requirement',
      entityId: target.requirementId
    });

    return successor;
  }

  async rejectRequirement(input: RejectRequirementInput): Promise<RequirementRevision> {
    const trimmedRationale = this.assertNonEmptyRationale(input.rationale, 'reject a requirement');
    const revId = createRequirementRevisionId(input.revisionId);
    const target = await this.repository.getRequirementRevision(revId);
    if (!target) {
      throw new UnknownRequirementRevisionError(revId);
    }

    await this.assertLatestRevision(target);

    if (target.reviewState !== 'PENDING') {
      throw new InvalidTransitionError(
        `Cannot reject requirement with reviewState '${target.reviewState}': only PENDING requirements may be rejected`
      );
    }

    const successorId = input.newRevisionId
      ? createRequirementRevisionId(input.newRevisionId)
      : createRequirementRevisionId(`${target.requirementId}-R${target.revision + 1}`);

    const successor = reviseRequirement(target, {
      id: successorId,
      reviewState: 'REJECTED',
      rationale: trimmedRationale
    });

    const history = await this.repository.listReconciliationRecords(
      'requirement',
      target.requirementId
    );
    const prevReview =
      history.length === 0 ? undefined : history[history.length - 1].newReviewState;

    await this.repository.transitionRequirementRevision(
      successor,
      {
        id: randomUUID(),
        entityType: 'requirement',
        entityId: target.requirementId,
        requirementRevisionId: successor.id,
        action: 'REJECT',
        previousReviewState: prevReview,
        newReviewState: 'REJECTED',
        rationale: trimmedRationale,
        actorId: input.actorId ? createActorId(input.actorId) : undefined,
        recordedAt: now()
      },
      target.id
    );

    OperationalLogger.log('command.executed', {
      command: 'reject_requirement',
      entityId: target.requirementId
    });

    return successor;
  }

  async reviseRequirement(input: ReviseRequirementInput): Promise<RequirementRevision> {
    const trimmedRationale = this.assertNonEmptyRationale(input.rationale, 'revise a requirement');
    const revId = createRequirementRevisionId(input.revisionId);
    const target = await this.repository.getRequirementRevision(revId);
    if (!target) {
      throw new UnknownRequirementRevisionError(revId);
    }

    await this.assertLatestRevision(target);

    const statementChanged =
      input.statement !== undefined && input.statement.trim() !== target.statement;
    const categoryChanged = input.category !== undefined && input.category !== target.category;
    const originChanged = input.origin !== undefined && input.origin !== target.origin;
    const evidenceChanged =
      input.evidence !== undefined && !evidenceEqual(input.evidence, target.evidence);
    const actorsChanged =
      input.affectedActors !== undefined &&
      !stringArraysEqual(input.affectedActors.map(String), target.affectedActors?.map(String));
    const dependenciesChanged =
      input.dependencies !== undefined &&
      !stringArraysEqual(input.dependencies.map(String), target.dependencies?.map(String));

    const meaningOrProvenanceChanged =
      statementChanged ||
      categoryChanged ||
      originChanged ||
      evidenceChanged ||
      actorsChanged ||
      dependenciesChanged;

    let reviewState: RequirementReviewState;
    if (target.reviewState === 'REJECTED') {
      // Reopen rejected candidate
      reviewState = 'PENDING';
    } else if (meaningOrProvenanceChanged) {
      reviewState = 'PENDING';
    } else {
      reviewState = target.reviewState;
    }

    let resolutionState: RequirementResolutionState;
    if (meaningOrProvenanceChanged) {
      resolutionState = 'UNRESOLVED';
    } else {
      resolutionState = target.resolutionState;
    }

    const successorId = input.newRevisionId
      ? createRequirementRevisionId(input.newRevisionId)
      : createRequirementRevisionId(`${target.requirementId}-R${target.revision + 1}`);

    const successor = reviseRequirement(target, {
      id: successorId,
      statement: input.statement,
      category: input.category,
      origin: input.origin,
      evidence: input.evidence,
      affectedActors: input.affectedActors?.map((a) => createActorId(a)),
      dependencies: input.dependencies?.map((d) => createRequirementId(d)),
      reviewState,
      resolutionState,
      rationale: trimmedRationale
    });

    const history = await this.repository.listReconciliationRecords(
      'requirement',
      target.requirementId
    );
    const prevReview =
      history.length === 0 ? undefined : history[history.length - 1].newReviewState;

    const resolutionChanged = target.resolutionState !== successor.resolutionState;

    await this.repository.transitionRequirementRevision(
      successor,
      {
        id: randomUUID(),
        entityType: 'requirement',
        entityId: target.requirementId,
        requirementRevisionId: successor.id,
        action: 'REVISE',
        previousReviewState: prevReview,
        newReviewState: successor.reviewState,
        previousResolutionState: resolutionChanged ? target.resolutionState : undefined,
        newResolutionState: resolutionChanged ? successor.resolutionState : undefined,
        rationale: trimmedRationale,
        actorId: input.actorId ? createActorId(input.actorId) : undefined,
        recordedAt: now()
      },
      target.id
    );

    OperationalLogger.log('command.executed', {
      command: 'revise_requirement',
      entityId: target.requirementId
    });

    return successor;
  }

  async resolveRequirement(input: ResolveRequirementInput): Promise<RequirementRevision> {
    const trimmedRationale = this.assertNonEmptyRationale(input.rationale, 'resolve a requirement');
    const revId = createRequirementRevisionId(input.revisionId);
    const target = await this.repository.getRequirementRevision(revId);
    if (!target) {
      throw new UnknownRequirementRevisionError(revId);
    }

    await this.assertLatestRevision(target);

    if (target.resolutionState === 'CLEAR') {
      throw new AlreadyClearError(target.id);
    }

    const successorId = input.newRevisionId
      ? createRequirementRevisionId(input.newRevisionId)
      : createRequirementRevisionId(`${target.requirementId}-R${target.revision + 1}`);

    const successor = reviseRequirement(target, {
      id: successorId,
      resolutionState: 'CLEAR',
      reviewState: target.reviewState,
      rationale: trimmedRationale
    });

    const history = await this.repository.listReconciliationRecords(
      'requirement',
      target.requirementId
    );
    const prevReview =
      history.length === 0 ? undefined : history[history.length - 1].newReviewState;

    await this.repository.transitionRequirementRevision(
      successor,
      {
        id: randomUUID(),
        entityType: 'requirement',
        entityId: target.requirementId,
        requirementRevisionId: successor.id,
        action: 'RESOLVE',
        previousReviewState: prevReview,
        newReviewState: successor.reviewState,
        previousResolutionState: target.resolutionState,
        newResolutionState: 'CLEAR',
        rationale: trimmedRationale,
        actorId: input.actorId ? createActorId(input.actorId) : undefined,
        recordedAt: now()
      },
      target.id
    );

    OperationalLogger.log('command.executed', {
      command: 'resolve_requirement',
      entityId: target.requirementId
    });

    return successor;
  }

  async dispositionFinding(input: DispositionFindingInput): Promise<CandidateFinding> {
    const trimmedRationale = input.rationale?.trim();
    if (!trimmedRationale) {
      throw new FindingRationaleRequiredError(input.disposition);
    }

    const findingId = createFindingId(input.findingId);
    const target = await this.repository.getCandidateFinding(findingId);
    if (!target) {
      throw new UnknownCandidateFindingError(findingId);
    }

    if (target.disposition === input.disposition) {
      throw new InvalidTransitionError(
        `Finding '${target.id}' already has disposition '${input.disposition}'`
      );
    }

    let updated: CandidateFinding;
    switch (input.disposition) {
      case 'RESOLVED':
        updated = resolveFinding(target, trimmedRationale);
        break;
      case 'DISMISSED_FALSE_POSITIVE':
        updated = dismissAsFalsePositive(target, trimmedRationale);
        break;
      case 'ACCEPTED_RISK':
        updated = acceptRisk(target, trimmedRationale);
        break;
      case 'OPEN':
        updated = domainReopenFinding(target, trimmedRationale);
        break;
      default:
        throw new InvalidTransitionError(`Unsupported disposition: '${input.disposition}'`);
    }

    await this.repository.transitionCandidateFinding(
      updated,
      {
        id: randomUUID(),
        entityType: 'finding',
        entityId: target.id,
        previousDisposition: target.disposition,
        newDisposition: input.disposition,
        rationale: trimmedRationale,
        actorId: input.actorId ? createActorId(input.actorId) : undefined,
        recordedAt: now()
      },
      target.disposition
    );

    OperationalLogger.log('command.executed', {
      command: 'disposition_finding',
      entityId: target.id,
      disposition: input.disposition
    });

    return updated;
  }

  async reopenFinding(input: ReopenFindingInput): Promise<CandidateFinding> {
    const normalizedRationale = input.rationale?.trim() || 'Reopened candidate finding';

    const findingId = createFindingId(input.findingId);
    const target = await this.repository.getCandidateFinding(findingId);
    if (!target) {
      throw new UnknownCandidateFindingError(findingId);
    }

    if (target.disposition === 'OPEN') {
      throw new InvalidTransitionError(`Finding '${target.id}' is already OPEN`);
    }

    const updated = domainReopenFinding(target, normalizedRationale);

    await this.repository.transitionCandidateFinding(
      updated,
      {
        id: randomUUID(),
        entityType: 'finding',
        entityId: target.id,
        previousDisposition: target.disposition,
        newDisposition: 'OPEN',
        rationale: normalizedRationale,
        actorId: input.actorId ? createActorId(input.actorId) : undefined,
        recordedAt: now()
      },
      target.disposition
    );

    OperationalLogger.log('command.executed', {
      command: 'reopen_finding',
      entityId: target.id
    });

    return updated;
  }
}
