import type { EvaluationSourceDto, SourceLineageMapEntryDto } from '@solutions-studio/contracts';
import type { SourceRevisionRecord } from '../ports/persistence/IRequirementsRepository.js';

export interface SourceLineageMap {
  readonly entries: readonly SourceLineageMapEntryDto[];
  readonly declaredToCaptured: ReadonlyMap<string, string>;
  readonly capturedToDeclared: ReadonlyMap<string, string>;
  resolveDeclared(alias: string): string;
  resolveCaptured(capturedId: string): string;
}

export class LineageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LineageValidationError';
  }
}

export function validateSourceLineage(
  declaredSources: readonly EvaluationSourceDto[],
  capturedRecords: readonly SourceRevisionRecord[],
  declaredContentHashes?: ReadonlyMap<string, string> | Record<string, string>
): SourceLineageMap {
  if (declaredSources.length !== capturedRecords.length) {
    throw new LineageValidationError(
      `Source count mismatch: declared ${declaredSources.length} sources but captured ${capturedRecords.length}`
    );
  }

  const entries: SourceLineageMapEntryDto[] = [];
  const declaredToCaptured = new Map<string, string>();
  const capturedToDeclared = new Map<string, string>();

  for (let i = 0; i < declaredSources.length; i++) {
    const decl = declaredSources[i];
    const cap = capturedRecords[i];

    if (declaredToCaptured.has(decl.sourceRevisionId)) {
      throw new LineageValidationError(
        `Duplicate declared source revision alias: '${decl.sourceRevisionId}'`
      );
    }

    if (capturedToDeclared.has(cap.revision.id)) {
      throw new LineageValidationError(
        `Non-bijective source mapping: captured revision ID '${cap.revision.id}' was already mapped`
      );
    }

    if (decl.sourceId !== cap.revision.sourceId) {
      throw new LineageValidationError(
        `Source ID mismatch for alias '${decl.sourceRevisionId}': declared '${decl.sourceId}' but captured '${cap.revision.sourceId}'`
      );
    }

    if (decl.revision !== cap.revision.revision) {
      throw new LineageValidationError(
        `Ordinal mismatch for alias '${decl.sourceRevisionId}': declared ordinal ${decl.revision} but captured ordinal ${cap.revision.revision}`
      );
    }

    if (declaredContentHashes) {
      const expectedHash =
        declaredContentHashes instanceof Map
          ? declaredContentHashes.get(decl.sourceRevisionId)
          : (declaredContentHashes as Record<string, string>)[decl.sourceRevisionId];
      if (expectedHash !== undefined && expectedHash !== cap.revision.contentHash) {
        throw new LineageValidationError(
          `Content hash mismatch for alias '${decl.sourceRevisionId}': expected '${expectedHash}' but captured '${cap.revision.contentHash}'`
        );
      }
    }

    // Predecessor translation validation
    if (decl.supersedes === undefined) {
      if (cap.revision.supersedes !== undefined) {
        throw new LineageValidationError(
          `Predecessor mismatch for root source alias '${decl.sourceRevisionId}': declared no predecessor, but captured record supersedes '${cap.revision.supersedes}'`
        );
      }
    } else {
      const expectedCapturedPredecessor = declaredToCaptured.get(decl.supersedes);
      if (!expectedCapturedPredecessor) {
        throw new LineageValidationError(
          `Predecessor alias '${decl.supersedes}' for '${decl.sourceRevisionId}' has not been captured yet in declaration order`
        );
      }

      if (cap.revision.supersedes !== expectedCapturedPredecessor) {
        throw new LineageValidationError(
          `Translated predecessor mismatch for alias '${decl.sourceRevisionId}': expected captured predecessor '${expectedCapturedPredecessor}', got '${cap.revision.supersedes ?? 'none'}'`
        );
      }
    }

    const entry: SourceLineageMapEntryDto = Object.freeze({
      declaredRevisionId: decl.sourceRevisionId,
      declaredSourceId: decl.sourceId,
      declaredOrdinal: decl.revision,
      declaredPredecessorAlias: decl.supersedes,
      capturedRevisionId: cap.revision.id,
      capturedSourceId: cap.revision.sourceId,
      capturedOrdinal: cap.revision.revision,
      capturedPredecessorId: cap.revision.supersedes,
      contentHash: cap.revision.contentHash
    });

    entries.push(entry);
    declaredToCaptured.set(decl.sourceRevisionId, cap.revision.id);
    capturedToDeclared.set(cap.revision.id, decl.sourceRevisionId);
  }

  const frozenEntries = Object.freeze(entries);
  const frozenDeclaredMap: ReadonlyMap<string, string> = new Map(declaredToCaptured);
  const frozenCapturedMap: ReadonlyMap<string, string> = new Map(capturedToDeclared);

  return Object.freeze({
    entries: frozenEntries,
    declaredToCaptured: frozenDeclaredMap,
    capturedToDeclared: frozenCapturedMap,
    resolveDeclared(alias: string): string {
      const resolved = frozenDeclaredMap.get(alias);
      if (!resolved) {
        throw new LineageValidationError(`Unknown declared source revision alias: '${alias}'`);
      }
      return resolved;
    },
    resolveCaptured(capturedId: string): string {
      const resolved = frozenCapturedMap.get(capturedId);
      if (!resolved) {
        throw new LineageValidationError(
          `Unknown captured repository revision ID: '${capturedId}'`
        );
      }
      return resolved;
    }
  });
}
