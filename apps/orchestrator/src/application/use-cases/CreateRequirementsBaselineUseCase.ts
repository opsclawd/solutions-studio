import { randomUUID } from 'node:crypto';
import {
  createRequirementsBaseline,
  createRequirementsBaselineId,
  createReviewerId,
  createInstant,
  createRequirementRevisionId,
  now,
  EmptyBaselineError,
  type RequirementsBaseline,
  type RequirementsBaselineId,
  type RequirementRevisionId,
  type ReviewerId,
  type Instant,
  type RequirementRevision
} from '@solutions-studio/domain';
import type { IRequirementsRepository } from '../ports/persistence/IRequirementsRepository.js';
import {
  BlockedByOpenFindingsError,
  StaleRevisionTargetError,
  UnauditedRequirementRevisionError,
  UnauditedFindingDispositionError,
  UnknownRequirementRevisionError
} from './ReconciliationErrors.js';
import { resolveRevisionLineage, selectBlockingFindings } from './resolveRevisionLineage.js';

export interface CreateRequirementsBaselineInput {
  readonly id?: RequirementsBaselineId | string;
  readonly requirementRevisionIds: readonly (RequirementRevisionId | string)[];
  readonly createdBy: ReviewerId | string;
  readonly createdAt?: Instant | string;
}

export class CreateRequirementsBaselineUseCase {
  constructor(private readonly repository: IRequirementsRepository) {}

  async create(input: CreateRequirementsBaselineInput): Promise<RequirementsBaseline> {
    if (!input.requirementRevisionIds || input.requirementRevisionIds.length === 0) {
      throw new EmptyBaselineError();
    }

    const revisions: RequirementRevision[] = [];
    for (const rawId of input.requirementRevisionIds) {
      const revId = createRequirementRevisionId(rawId);
      const rev = await this.repository.getRequirementRevision(revId);
      if (!rev) {
        throw new UnknownRequirementRevisionError(revId);
      }
      revisions.push(rev);
    }

    const baselineId = input.id
      ? createRequirementsBaselineId(input.id)
      : createRequirementsBaselineId(`BASELINE-${randomUUID()}`);
    const createdBy = createReviewerId(input.createdBy);
    const createdAt = input.createdAt ? createInstant(input.createdAt) : now();

    const baseline = createRequirementsBaseline({
      id: baselineId,
      requirements: revisions,
      createdBy,
      createdAt
    });

    // Authority gate: verify that each proposed revision is the requirement's current latest revision
    for (const rev of revisions) {
      const allRevisions = await this.repository.listRequirementRevisions(rev.requirementId);
      if (allRevisions.length > 0) {
        const latest = allRevisions[allRevisions.length - 1];
        if (latest.id !== rev.id) {
          throw new StaleRevisionTargetError(rev.id, latest.id);
        }
      }
    }

    const proposedIds = revisions.map((r) => r.id);
    const lineage = await resolveRevisionLineage(proposedIds, (id) =>
      this.repository.getRequirementRevision(id)
    );

    // Authority gate: verify that every proposed revision has human acceptance audit history
    for (const rev of revisions) {
      const history = await this.repository.listReconciliationRecords(
        'requirement',
        rev.requirementId
      );
      const isAcceptedInHistory = history.some(
        (rec) =>
          rec.newReviewState === 'ACCEPTED' &&
          (rec.requirementRevisionId === rev.id ||
            lineage.proposedToAncestors.get(rev.id)?.includes(rec.requirementRevisionId))
      );
      if (!isAcceptedInHistory) {
        throw new UnauditedRequirementRevisionError(rev.id);
      }
    }

    const allFindings = await this.repository.listCandidateFindings();

    // Authority gate: verify non-OPEN findings affecting proposed lineage have valid audit history
    for (const finding of allFindings) {
      const affectsProposed = finding.affectedRequirementRevisions.some((revId) =>
        lineage.closure.has(revId)
      );
      if (!affectsProposed) {
        continue;
      }

      if (finding.disposition !== 'OPEN') {
        const history = await this.repository.listReconciliationRecords('finding', finding.id);
        const latest = history.length > 0 ? history[history.length - 1] : undefined;
        if (
          !latest ||
          latest.entityType !== 'finding' ||
          latest.entityId !== finding.id ||
          latest.newDisposition !== finding.disposition ||
          !latest.rationale ||
          latest.rationale.trim().length === 0 ||
          latest.rationale.trim() !== (finding.rationale ?? '').trim()
        ) {
          throw new UnauditedFindingDispositionError(finding.id, finding.disposition);
        }
      }
    }

    const blockingMatches = await selectBlockingFindings(allFindings, proposedIds, lineage);

    if (blockingMatches.length > 0) {
      throw new BlockedByOpenFindingsError(blockingMatches);
    }

    await this.repository.saveRequirementsBaselineConditional(baseline, proposedIds);

    return baseline;
  }

  async execute(input: CreateRequirementsBaselineInput): Promise<RequirementsBaseline> {
    return this.create(input);
  }
}
