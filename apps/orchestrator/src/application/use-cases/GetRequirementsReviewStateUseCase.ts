import {
  createRequirementsBaselineId,
  createSourceRevisionId,
  type RequirementsBaseline,
  type RequirementsBaselineId,
  type RequirementRevision,
  type CandidateFinding
} from '@solutions-studio/domain';
import type {
  IRequirementsRepository,
  ReconciliationRecord,
  ProjectionRecord
} from '../ports/persistence/IRequirementsRepository.js';
import {
  UnknownRequirementRevisionError,
  UnknownRequirementsBaselineError
} from './ReconciliationErrors.js';
import { resolveRevisionLineage } from './resolveRevisionLineage.js';

export interface EvidenceExcerpt {
  readonly sourceRevisionId: string;
  readonly locator: string;
  readonly headingPath: string;
  readonly blockLabel: string;
  readonly blockLabelSource?: 'explicit-section' | 'sequential-ordinal';
  readonly text: string;
  readonly startLine: number;
  readonly endLine: number;
}

export interface RevisionLineageEntry {
  readonly revisionId: string;
  readonly requirementId: string;
}

export interface RequirementsReviewState {
  readonly baseline?: RequirementsBaseline;
  readonly requirementRevisions: readonly RequirementRevision[];
  readonly findings: readonly CandidateFinding[];
  readonly reconciliationHistory: readonly ReconciliationRecord[];
  readonly evidenceExcerpts: readonly EvidenceExcerpt[];
  readonly projections: readonly ProjectionRecord[];
  readonly revisionLineage: readonly RevisionLineageEntry[];
  readonly availableBaselines?: readonly string[];
}

export interface GetRequirementsReviewStateInput {
  readonly baselineId?: RequirementsBaselineId | string;
}

export class GetRequirementsReviewStateUseCase {
  constructor(private readonly repository: IRequirementsRepository) {}

  async listBaselines(): Promise<readonly RequirementsBaseline[]> {
    return this.repository.listRequirementsBaselines();
  }

  async get(input: GetRequirementsReviewStateInput = {}): Promise<RequirementsReviewState> {
    let baseline: RequirementsBaseline | undefined = undefined;
    const revisions: RequirementRevision[] = [];
    const allBaselines = await this.repository.listRequirementsBaselines();
    const allProjections = await this.repository.listProjectionRecords();

    if (input.baselineId) {
      const baselineId = createRequirementsBaselineId(input.baselineId);
      const foundBaseline = await this.repository.getRequirementsBaseline(baselineId);
      if (!foundBaseline) {
        throw new UnknownRequirementsBaselineError(input.baselineId);
      }
      baseline = foundBaseline;

      const baselineMemberReqIds = new Set<string>();
      for (const revId of foundBaseline.requirementRevisions) {
        const rev = await this.repository.getRequirementRevision(revId);
        if (!rev) {
          throw new UnknownRequirementRevisionError(revId);
        }
        baselineMemberReqIds.add(rev.requirementId);
        const memberRevs = await this.repository.listRequirementRevisions(rev.requirementId);
        const latest = memberRevs.length > 0 ? memberRevs[memberRevs.length - 1] : rev;
        revisions.push(latest);
      }

      const baselineProjections = allProjections.filter((p) => p.baselineId === baselineId);
      const projectionIds = new Set(baselineProjections.map((p) => p.id));

      const reqIds = await this.repository.listRequirementIds();
      for (const reqId of reqIds) {
        if (baselineMemberReqIds.has(reqId)) continue;
        const revs = await this.repository.listRequirementRevisions(reqId);
        const isAssociated = revs.some(
          (r) =>
            r.baselineId === baselineId ||
            (r.originatingProjectionId && projectionIds.has(r.originatingProjectionId))
        );
        if (isAssociated && revs.length > 0) {
          const latest = revs[revs.length - 1];
          if (!revisions.some((r) => r.id === latest.id)) {
            revisions.push(latest);
          }
        }
      }
    } else {
      const reqIds = await this.repository.listRequirementIds();
      for (const reqId of reqIds) {
        const revs = await this.repository.listRequirementRevisions(reqId);
        if (revs.length > 0) {
          revisions.push(revs[revs.length - 1]);
        }
      }
    }

    if (revisions.length === 0) {
      return {
        baseline,
        requirementRevisions: Object.freeze([]),
        findings: Object.freeze([]),
        reconciliationHistory: Object.freeze([]),
        evidenceExcerpts: Object.freeze([]),
        projections: Object.freeze([...allProjections]),
        revisionLineage: Object.freeze([]),
        availableBaselines: Object.freeze(allBaselines.map((b) => b.id))
      };
    }

    const proposedIds = revisions.map((r) => r.id);
    const lineage = await resolveRevisionLineage(proposedIds, (id) =>
      this.repository.getRequirementRevision(id)
    );

    const revisionMap = new Map<string, RequirementRevision>();
    for (const rev of revisions) {
      revisionMap.set(rev.id, rev);
    }

    const revisionLineage: RevisionLineageEntry[] = [];
    for (const revId of lineage.closure) {
      const inHand = revisionMap.get(revId);
      if (inHand) {
        revisionLineage.push({ revisionId: revId, requirementId: inHand.requirementId });
      } else {
        const ancestor = await this.repository.getRequirementRevision(revId);
        if (ancestor) {
          revisionLineage.push({ revisionId: revId, requirementId: ancestor.requirementId });
        }
      }
    }

    const allFindings = await this.repository.listCandidateFindings();
    const inScopeFindings = allFindings.filter(
      (f) =>
        f.affectedRequirementRevisions.length === 0 ||
        f.affectedRequirementRevisions.some((revId) => lineage.closure.has(revId))
    );

    const inScopeFindingIds = new Set<string>(inScopeFindings.map((f) => f.id));
    const inScopeRequirementIds = new Set<string>(revisions.map((r) => r.requirementId));

    const allReconciliation = await this.repository.listAllReconciliationRecords();
    const inScopeReconciliation = allReconciliation.filter((rec) => {
      if (rec.entityType === 'requirement') {
        return (
          inScopeRequirementIds.has(rec.entityId) || lineage.closure.has(rec.requirementRevisionId)
        );
      }
      if (rec.entityType === 'finding') {
        return inScopeFindingIds.has(rec.entityId);
      }
      return false;
    });

    const seenExcerptKeys = new Set<string>();
    const evidenceExcerpts: EvidenceExcerpt[] = [];

    const collectRef = async (sourceRevisionId: string, locator: string) => {
      const key = `${sourceRevisionId}::${locator}`;
      if (seenExcerptKeys.has(key)) return;
      seenExcerptKeys.add(key);

      const entry = await this.repository.resolveLocator(
        createSourceRevisionId(sourceRevisionId),
        locator
      );
      if (entry) {
        evidenceExcerpts.push({
          sourceRevisionId,
          locator: entry.locator,
          headingPath: entry.headingPath,
          blockLabel: entry.blockLabel,
          blockLabelSource: entry.blockLabelSource,
          text: entry.text,
          startLine: entry.startLine,
          endLine: entry.endLine
        });
      }
    };

    for (const rev of revisions) {
      for (const ev of rev.evidence) {
        await collectRef(ev.sourceRevisionId, ev.locator);
      }
    }

    for (const f of inScopeFindings) {
      for (const ev of f.evidence) {
        await collectRef(ev.sourceRevisionId, ev.locator);
      }
    }

    return {
      baseline,
      requirementRevisions: Object.freeze(revisions),
      findings: Object.freeze(inScopeFindings),
      reconciliationHistory: Object.freeze(inScopeReconciliation),
      evidenceExcerpts: Object.freeze(evidenceExcerpts),
      projections: Object.freeze([...allProjections]),
      revisionLineage: Object.freeze(revisionLineage),
      availableBaselines: Object.freeze(allBaselines.map((b) => b.id))
    };
  }
}
