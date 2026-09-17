import type { EvidenceExpectationDto } from '@solutions-studio/contracts';

export function normalizeEvidence(
  evidence: readonly EvidenceExpectationDto[]
): readonly EvidenceExpectationDto[] {
  const map = new Map<string, EvidenceExpectationDto>();
  for (const ref of evidence) {
    const key = `${ref.sourceRevisionId}::${ref.locator}`;
    if (!map.has(key)) {
      map.set(key, {
        sourceRevisionId: ref.sourceRevisionId,
        locator: ref.locator
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    const cmp = a.sourceRevisionId.localeCompare(b.sourceRevisionId);
    if (cmp !== 0) return cmp;
    return a.locator.localeCompare(b.locator);
  });
}

export function areEvidenceSetsEqual(
  a: readonly EvidenceExpectationDto[],
  b: readonly EvidenceExpectationDto[]
): boolean {
  const normA = normalizeEvidence(a);
  const normB = normalizeEvidence(b);

  if (normA.length !== normB.length) {
    return false;
  }

  for (let i = 0; i < normA.length; i++) {
    if (
      normA[i].sourceRevisionId !== normB[i].sourceRevisionId ||
      normA[i].locator !== normB[i].locator
    ) {
      return false;
    }
  }

  return true;
}
