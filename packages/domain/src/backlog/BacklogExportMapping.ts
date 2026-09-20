import type { StoryId, RequirementsBaselineId, ActorId, Instant } from '../requirements/ids.js';
import {
  createStoryId,
  createRequirementsBaselineId,
  createActorId,
  createInstant
} from '../requirements/ids.js';
import type { BacklogExportMappingId } from './ids.js';
import { createBacklogExportMappingId } from './ids.js';
import { InvalidBacklogMappingError } from './errors.js';

export interface BacklogExportMapping {
  readonly id: BacklogExportMappingId;
  readonly storyId: StoryId;
  readonly baselineId: RequirementsBaselineId;
  readonly provider: string;
  readonly externalContainer: string;
  readonly externalWorkItemId: string;
  readonly externalUrl?: string;
  readonly exportContentHash: string;
  readonly exportedAt: Instant;
  readonly exportedBy: ActorId;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CreateBacklogExportMappingParams {
  readonly id: BacklogExportMappingId | string;
  readonly storyId: StoryId | string;
  readonly baselineId: RequirementsBaselineId | string;
  readonly provider: string;
  readonly externalContainer: string;
  readonly externalWorkItemId: string;
  readonly externalUrl?: string;
  readonly exportContentHash: string;
  readonly exportedAt: Instant | string;
  readonly exportedBy: ActorId | string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

const SHA256_REGEX = /^[a-f0-9]{64}$/i;

export function createBacklogExportMapping(
  params: CreateBacklogExportMappingParams
): BacklogExportMapping {
  if (!params.id || typeof params.id !== 'string' || params.id.trim().length === 0) {
    throw new InvalidBacklogMappingError('id must be a non-empty string');
  }
  const id = createBacklogExportMappingId(params.id);

  if (!params.storyId || typeof params.storyId !== 'string' || params.storyId.trim().length === 0) {
    throw new InvalidBacklogMappingError('storyId must be a non-empty string');
  }
  const storyId = createStoryId(params.storyId);

  if (
    !params.baselineId ||
    typeof params.baselineId !== 'string' ||
    params.baselineId.trim().length === 0
  ) {
    throw new InvalidBacklogMappingError('baselineId must be a non-empty string');
  }
  const baselineId = createRequirementsBaselineId(params.baselineId);

  if (
    !params.provider ||
    typeof params.provider !== 'string' ||
    params.provider.trim().length === 0
  ) {
    throw new InvalidBacklogMappingError('provider must be a non-empty string');
  }
  const provider = params.provider.trim();

  if (
    !params.externalContainer ||
    typeof params.externalContainer !== 'string' ||
    params.externalContainer.trim().length === 0
  ) {
    throw new InvalidBacklogMappingError('externalContainer must be a non-empty string');
  }
  const externalContainer = params.externalContainer.trim();

  if (
    !params.externalWorkItemId ||
    typeof params.externalWorkItemId !== 'string' ||
    params.externalWorkItemId.trim().length === 0
  ) {
    throw new InvalidBacklogMappingError('externalWorkItemId must be a non-empty string');
  }
  const externalWorkItemId = params.externalWorkItemId.trim();

  let externalUrl: string | undefined;
  if (params.externalUrl !== undefined && params.externalUrl !== null) {
    if (typeof params.externalUrl !== 'string' || params.externalUrl.trim().length === 0) {
      throw new InvalidBacklogMappingError('externalUrl must be a non-empty string if provided');
    }
    externalUrl = params.externalUrl.trim();
  }

  if (
    !params.exportContentHash ||
    typeof params.exportContentHash !== 'string' ||
    !SHA256_REGEX.test(params.exportContentHash)
  ) {
    throw new InvalidBacklogMappingError(
      `exportContentHash must be a valid 64-character SHA-256 hex string, received '${params.exportContentHash}'`
    );
  }
  const exportContentHash = params.exportContentHash.toLowerCase();

  if (!params.exportedAt || typeof params.exportedAt !== 'string') {
    throw new InvalidBacklogMappingError('exportedAt must be a valid ISO-8601 instant string');
  }
  const exportedAt = createInstant(params.exportedAt);

  if (
    !params.exportedBy ||
    typeof params.exportedBy !== 'string' ||
    params.exportedBy.trim().length === 0
  ) {
    throw new InvalidBacklogMappingError('exportedBy must be a non-empty string');
  }
  const exportedBy = createActorId(params.exportedBy);

  let metadata: Readonly<Record<string, unknown>> | undefined;
  if (params.metadata) {
    if (typeof params.metadata !== 'object') {
      throw new InvalidBacklogMappingError('metadata must be an object');
    }
    metadata = Object.freeze({ ...params.metadata });
  }

  return Object.freeze({
    id,
    storyId,
    baselineId,
    provider,
    externalContainer,
    externalWorkItemId,
    externalUrl,
    exportContentHash,
    exportedAt,
    exportedBy,
    metadata
  });
}
