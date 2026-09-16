import type { FindingId, RequirementRevisionId } from './ids.js';
import type { EvidenceReference } from './EvidenceReference.js';
import { DomainError, FindingRationaleRequiredError } from './errors.js';

export const FINDING_TYPES = [
  'contradiction',
  'missing-authorization',
  'incomplete-state-machine',
  'missing-failure-recovery',
  'undefined-cardinality',
  'temporal-ambiguity',
  'data-boundary-ambiguity',
  'unsupported-assumption',
  'subjective-normative-language'
] as const;

export type FindingType = (typeof FINDING_TYPES)[number];

export const FINDING_DISPOSITIONS = [
  'OPEN',
  'RESOLVED',
  'DISMISSED_FALSE_POSITIVE',
  'ACCEPTED_RISK'
] as const;

export type FindingDisposition = (typeof FINDING_DISPOSITIONS)[number];

export const DISCOVERED_BY = ['model', 'heuristic', 'artifact-validation', 'human'] as const;

export type DiscoveredBy = (typeof DISCOVERED_BY)[number];

export interface CandidateFinding {
  readonly id: FindingId;
  readonly type: FindingType;
  readonly affectedRequirementRevisions: readonly RequirementRevisionId[];
  readonly evidence: readonly EvidenceReference[];
  readonly discoveredBy: DiscoveredBy;
  readonly disposition: FindingDisposition;
  readonly rationale?: string;
}

export function createCandidateFinding(params: {
  id: FindingId;
  type: FindingType;
  affectedRequirementRevisions?: readonly RequirementRevisionId[];
  evidence?: readonly EvidenceReference[];
  discoveredBy: DiscoveredBy;
  disposition?: FindingDisposition;
  rationale?: string;
}): CandidateFinding {
  if (!FINDING_TYPES.includes(params.type)) {
    throw new DomainError(`Invalid FindingType: '${String(params.type)}'`);
  }

  if (!DISCOVERED_BY.includes(params.discoveredBy)) {
    throw new DomainError(`Invalid DiscoveredBy: '${String(params.discoveredBy)}'`);
  }

  const disposition = params.disposition ?? 'OPEN';
  if (!FINDING_DISPOSITIONS.includes(disposition)) {
    throw new DomainError(`Invalid FindingDisposition: '${String(disposition)}'`);
  }

  if (disposition !== 'OPEN') {
    if (typeof params.rationale !== 'string' || params.rationale.trim().length === 0) {
      throw new FindingRationaleRequiredError(disposition);
    }
  }

  const affectedRequirementRevisions = params.affectedRequirementRevisions
    ? Object.freeze([...params.affectedRequirementRevisions])
    : Object.freeze([]);

  const evidence = Object.freeze(
    params.evidence
      ? params.evidence.map((ref) =>
          Object.freeze({
            sourceRevisionId: ref.sourceRevisionId,
            locator: ref.locator
          })
        )
      : []
  );

  const rationale =
    disposition !== 'OPEN'
      ? params.rationale!.trim()
      : params.rationale !== undefined && params.rationale.trim().length > 0
        ? params.rationale.trim()
        : undefined;

  return Object.freeze({
    id: params.id,
    type: params.type,
    affectedRequirementRevisions,
    evidence,
    discoveredBy: params.discoveredBy,
    disposition,
    ...(rationale !== undefined ? { rationale } : {})
  });
}

function transitionDisposition(
  finding: CandidateFinding,
  newDisposition: FindingDisposition,
  rationale: string
): CandidateFinding {
  if (typeof rationale !== 'string' || rationale.trim().length === 0) {
    throw new FindingRationaleRequiredError(newDisposition);
  }

  return Object.freeze({
    id: finding.id,
    type: finding.type,
    affectedRequirementRevisions: finding.affectedRequirementRevisions,
    evidence: finding.evidence,
    discoveredBy: finding.discoveredBy,
    disposition: newDisposition,
    rationale: rationale.trim()
  });
}

export function resolveFinding(finding: CandidateFinding, rationale: string): CandidateFinding {
  return transitionDisposition(finding, 'RESOLVED', rationale);
}

export function dismissAsFalsePositive(
  finding: CandidateFinding,
  rationale: string
): CandidateFinding {
  return transitionDisposition(finding, 'DISMISSED_FALSE_POSITIVE', rationale);
}

export function acceptRisk(finding: CandidateFinding, rationale: string): CandidateFinding {
  return transitionDisposition(finding, 'ACCEPTED_RISK', rationale);
}

export function reopenFinding(finding: CandidateFinding, rationale?: string): CandidateFinding {
  return Object.freeze({
    id: finding.id,
    type: finding.type,
    affectedRequirementRevisions: finding.affectedRequirementRevisions,
    evidence: finding.evidence,
    discoveredBy: finding.discoveredBy,
    disposition: 'OPEN',
    ...(rationale !== undefined && rationale.trim().length > 0
      ? { rationale: rationale.trim() }
      : {})
  });
}
