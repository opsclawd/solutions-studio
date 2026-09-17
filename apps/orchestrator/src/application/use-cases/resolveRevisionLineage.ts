import type {
  CandidateFinding,
  RequirementRevision,
  RequirementRevisionId
} from '@solutions-studio/domain';
import type { IRequirementsRepository } from '../ports/persistence/IRequirementsRepository.js';
import {
  MissingRevisionAncestorError,
  RevisionLineageCycleError,
  UnknownRequirementRevisionError,
  type BlockingFindingMatch
} from './ReconciliationErrors.js';

export interface RevisionLineageResult {
  readonly closure: ReadonlySet<RequirementRevisionId>;
  readonly proposedToAncestors: ReadonlyMap<
    RequirementRevisionId,
    readonly RequirementRevisionId[]
  >;
  readonly ancestorToProposed: ReadonlyMap<RequirementRevisionId, readonly RequirementRevisionId[]>;
}

export type RevisionLookup =
  | IRequirementsRepository
  | ((id: RequirementRevisionId) => Promise<RequirementRevision | undefined>)
  | RevisionLineageResult;

export async function resolveRevisionLineage(
  proposedRevisionIds: readonly RequirementRevisionId[],
  getRequirementRevision: (id: RequirementRevisionId) => Promise<RequirementRevision | undefined>
): Promise<RevisionLineageResult> {
  const closure = new Set<RequirementRevisionId>();
  const proposedToAncestors = new Map<RequirementRevisionId, readonly RequirementRevisionId[]>();
  const ancestorToProposed = new Map<RequirementRevisionId, RequirementRevisionId[]>();

  for (const proposedId of proposedRevisionIds) {
    let current = await getRequirementRevision(proposedId);
    if (!current) {
      throw new UnknownRequirementRevisionError(proposedId);
    }

    const chainVisited = new Set<RequirementRevisionId>([proposedId]);
    const ancestors: RequirementRevisionId[] = [proposedId];
    closure.add(proposedId);

    const existingProposed = ancestorToProposed.get(proposedId) ?? [];
    if (!existingProposed.includes(proposedId)) {
      existingProposed.push(proposedId);
    }
    ancestorToProposed.set(proposedId, existingProposed);

    while (current.supersedes) {
      const nextId = current.supersedes;
      if (chainVisited.has(nextId)) {
        throw new RevisionLineageCycleError(nextId);
      }
      chainVisited.add(nextId);

      const ancestorRev = await getRequirementRevision(nextId);
      if (!ancestorRev) {
        throw new MissingRevisionAncestorError(nextId, current.id);
      }

      ancestors.push(nextId);
      closure.add(nextId);

      const mapped = ancestorToProposed.get(nextId) ?? [];
      if (!mapped.includes(proposedId)) {
        mapped.push(proposedId);
      }
      ancestorToProposed.set(nextId, mapped);

      current = ancestorRev;
    }

    proposedToAncestors.set(proposedId, Object.freeze(ancestors));
  }

  const frozenAncestorToProposed = new Map<
    RequirementRevisionId,
    readonly RequirementRevisionId[]
  >();
  for (const [key, val] of ancestorToProposed.entries()) {
    frozenAncestorToProposed.set(key, Object.freeze(val));
  }

  return Object.freeze({
    closure: Object.freeze(closure),
    proposedToAncestors: Object.freeze(proposedToAncestors),
    ancestorToProposed: Object.freeze(frozenAncestorToProposed)
  });
}

export async function selectBlockingFindings(
  findings: readonly CandidateFinding[],
  proposedRevisionIds: readonly RequirementRevisionId[],
  revisionLookup: RevisionLookup
): Promise<readonly BlockingFindingMatch[]> {
  let lineage: RevisionLineageResult;

  if ('closure' in revisionLookup) {
    lineage = revisionLookup;
  } else {
    const getRevision =
      typeof revisionLookup === 'function'
        ? revisionLookup
        : (id: RequirementRevisionId) => revisionLookup.getRequirementRevision(id);
    lineage = await resolveRevisionLineage(proposedRevisionIds, getRevision);
  }

  const results: BlockingFindingMatch[] = [];
  const seenMatches = new Set<string>();

  for (const finding of findings) {
    if (finding.disposition !== 'OPEN') {
      continue;
    }

    for (const affectedRevId of finding.affectedRequirementRevisions) {
      if (lineage.closure.has(affectedRevId)) {
        const proposedIds = lineage.ancestorToProposed.get(affectedRevId) ?? [];
        for (const proposedRevId of proposedIds) {
          const matchKey = `${finding.id}::${affectedRevId}::${proposedRevId}`;
          if (seenMatches.has(matchKey)) {
            continue;
          }
          seenMatches.add(matchKey);

          results.push({
            ...finding,
            finding,
            id: finding.id,
            type: finding.type,
            disposition: finding.disposition,
            affectedRequirementRevisions: finding.affectedRequirementRevisions,
            evidence: finding.evidence,
            discoveredBy: finding.discoveredBy,
            rationale: finding.rationale,
            affectedRevisionId: affectedRevId,
            matchedRevisionId: affectedRevId,
            proposedRevisionId: proposedRevId
          });
        }
      }
    }
  }

  return Object.freeze(results);
}
