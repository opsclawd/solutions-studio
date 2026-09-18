import type { CandidateFindingDto, RequirementsReviewStateDto } from '@solutions-studio/contracts';

export interface RevisionRequirementIndex {
  readonly revisionToRequirementId: ReadonlyMap<string, string>;
  readonly findingsByRequirementId: ReadonlyMap<string, readonly CandidateFindingDto[]>;
  readonly unresolvedFindings: readonly CandidateFindingDto[];
}

export function buildRevisionRequirementIndex(
  data: RequirementsReviewStateDto
): RevisionRequirementIndex {
  const revisionToRequirementId = new Map<string, string>();

  // 1. Primary server-authoritative source from revisionLineage
  if (data.revisionLineage) {
    for (const entry of data.revisionLineage) {
      revisionToRequirementId.set(entry.revisionId, entry.requirementId);
    }
  }

  // 2. Defensive belt-and-suspenders fallback from requirementRevisions
  if (data.requirementRevisions) {
    for (const rev of data.requirementRevisions) {
      revisionToRequirementId.set(rev.id, rev.requirementId);
    }
  }

  const findingsByReqMap = new Map<string, CandidateFindingDto[]>();
  const unresolvedFindings: CandidateFindingDto[] = [];

  for (const finding of data.findings) {
    if (
      !finding.affectedRequirementRevisions ||
      finding.affectedRequirementRevisions.length === 0
    ) {
      unresolvedFindings.push(finding);
      continue;
    }

    const resolvedOwners = new Set<string>();
    for (const revId of finding.affectedRequirementRevisions) {
      const reqId = revisionToRequirementId.get(revId);
      if (reqId) {
        resolvedOwners.add(reqId);
      }
    }

    if (resolvedOwners.size === 0) {
      unresolvedFindings.push(finding);
    } else {
      for (const ownerId of resolvedOwners) {
        let list = findingsByReqMap.get(ownerId);
        if (!list) {
          list = [];
          findingsByReqMap.set(ownerId, list);
        }
        if (!list.some((f) => f.id === finding.id)) {
          list.push(finding);
        }
      }
    }
  }

  return {
    revisionToRequirementId,
    findingsByRequirementId: findingsByReqMap,
    unresolvedFindings
  };
}
