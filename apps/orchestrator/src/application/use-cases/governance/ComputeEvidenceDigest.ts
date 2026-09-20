import crypto from 'node:crypto';
import type { ValidationArtifact } from '@solutions-studio/domain';

export interface ComputeEvidenceDigestInput {
  readonly candidateSha: string;
  readonly phase: string;
  readonly executionMode: string;
  readonly artifacts: readonly ValidationArtifact[];
  readonly summary?: Record<string, unknown>;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`
  );
  return `{${pairs.join(',')}}`;
}

export function computeEvidenceDigest(input: ComputeEvidenceDigestInput): string {
  const sortedArtifacts = [...input.artifacts].sort((a, b) => {
    const typeCmp = a.artifactType.localeCompare(b.artifactType);
    if (typeCmp !== 0) return typeCmp;
    return a.name.localeCompare(b.name);
  });

  const canonicalPayload = canonicalJson({
    artifacts: sortedArtifacts.map((a) => ({
      artifactType: a.artifactType,
      contentHash: a.contentHash.toLowerCase(),
      name: a.name,
      payloadRef: a.payloadRef ?? null
    })),
    candidateSha: input.candidateSha.toLowerCase(),
    executionMode: input.executionMode,
    phase: input.phase,
    summary: input.summary ?? {}
  });

  return crypto.createHash('sha256').update(canonicalPayload, 'utf8').digest('hex');
}
