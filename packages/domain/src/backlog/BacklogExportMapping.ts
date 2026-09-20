import type {
  StoryId,
  RequirementsBaselineId,
  RequirementRevisionId,
  PolicyConstraintRevisionId,
  ActorId,
  Instant
} from '../requirements/ids.js';
import {
  createStoryId,
  createRequirementsBaselineId,
  createRequirementRevisionId,
  createPolicyConstraintRevisionId,
  createActorId,
  createInstant
} from '../requirements/ids.js';
import type { BacklogExportMappingId } from './ids.js';
import { createBacklogExportMappingId } from './ids.js';
import { InvalidBacklogMappingError } from './errors.js';

export interface BacklogExportHistoryEntry {
  readonly exportVersion: number;
  readonly baselineId: RequirementsBaselineId;
  readonly storyVersion: number;
  readonly requirementRevisionIds: readonly RequirementRevisionId[];
  readonly policyConstraintRevisionIds?: readonly PolicyConstraintRevisionId[];
  readonly exportContentHash: string;
  readonly exportContentHashVersion?: number;
  readonly prerequisiteExportVersions?: Readonly<Record<string, number>>;
  readonly exportedAt: Instant;
  readonly exportedBy: ActorId;
  readonly externalWorkItemId: string;
  readonly externalUrl?: string;
  readonly updateRationale?: string;
}

export interface BacklogExportMapping {
  readonly id: BacklogExportMappingId;
  readonly storyId: StoryId;
  readonly storyVersion: number;
  readonly exportVersion: number;
  readonly baselineId: RequirementsBaselineId;
  readonly requirementRevisionIds: readonly RequirementRevisionId[];
  readonly policyConstraintRevisionIds?: readonly PolicyConstraintRevisionId[];
  readonly provider: string;
  readonly externalContainer: string;
  readonly externalWorkItemId: string;
  readonly externalUrl?: string;
  readonly exportContentHash: string;
  readonly exportContentHashVersion?: number;
  readonly prerequisiteExportVersions?: Readonly<Record<string, number>>;
  readonly exportedAt: Instant;
  readonly exportedBy: ActorId;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly history?: readonly BacklogExportHistoryEntry[];
}

export interface CreateBacklogExportMappingParams {
  readonly id: BacklogExportMappingId | string;
  readonly storyId: StoryId | string;
  readonly storyVersion?: number;
  readonly exportVersion?: number;
  readonly baselineId: RequirementsBaselineId | string;
  readonly requirementRevisionIds?: readonly (RequirementRevisionId | string)[];
  readonly policyConstraintRevisionIds?: readonly (PolicyConstraintRevisionId | string)[];
  readonly provider: string;
  readonly externalContainer: string;
  readonly externalWorkItemId: string;
  readonly externalUrl?: string;
  readonly exportContentHash: string;
  readonly exportContentHashVersion?: number;
  readonly prerequisiteExportVersions?: Readonly<Record<string, number>>;
  readonly exportedAt: Instant | string;
  readonly exportedBy: ActorId | string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly history?: readonly BacklogExportHistoryEntry[];
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

  let storyVersion = 1;
  if (params.storyVersion !== undefined) {
    if (
      typeof params.storyVersion !== 'number' ||
      !Number.isInteger(params.storyVersion) ||
      params.storyVersion < 1
    ) {
      throw new InvalidBacklogMappingError('storyVersion must be an integer >= 1');
    }
    storyVersion = params.storyVersion;
  }

  let exportVersion = 1;
  if (params.exportVersion !== undefined) {
    if (
      typeof params.exportVersion !== 'number' ||
      !Number.isInteger(params.exportVersion) ||
      params.exportVersion < 1
    ) {
      throw new InvalidBacklogMappingError('exportVersion must be an integer >= 1');
    }
    exportVersion = params.exportVersion;
  }

  const requirementRevisionIds: RequirementRevisionId[] = [];
  if (params.requirementRevisionIds) {
    if (!Array.isArray(params.requirementRevisionIds)) {
      throw new InvalidBacklogMappingError('requirementRevisionIds must be an array');
    }
    for (const rid of params.requirementRevisionIds) {
      if (!rid || typeof rid !== 'string' || rid.trim().length === 0) {
        throw new InvalidBacklogMappingError(
          'requirementRevisionIds must contain non-empty strings'
        );
      }
      requirementRevisionIds.push(createRequirementRevisionId(rid));
    }
  }
  const frozenReqRevs = Object.freeze(requirementRevisionIds);

  let frozenPolicyRevs: readonly PolicyConstraintRevisionId[] | undefined;
  if (params.policyConstraintRevisionIds !== undefined) {
    if (!Array.isArray(params.policyConstraintRevisionIds)) {
      throw new InvalidBacklogMappingError('policyConstraintRevisionIds must be an array');
    }
    const policyRevisionIds: PolicyConstraintRevisionId[] = [];
    for (const pid of params.policyConstraintRevisionIds) {
      if (!pid || typeof pid !== 'string' || pid.trim().length === 0) {
        throw new InvalidBacklogMappingError(
          'policyConstraintRevisionIds must contain non-empty strings'
        );
      }
      policyRevisionIds.push(createPolicyConstraintRevisionId(pid));
    }
    frozenPolicyRevs = Object.freeze(policyRevisionIds);
  }

  const exportContentHashVersion = params.exportContentHashVersion ?? 1;
  if (
    typeof exportContentHashVersion !== 'number' ||
    !Number.isInteger(exportContentHashVersion) ||
    exportContentHashVersion < 1
  ) {
    throw new InvalidBacklogMappingError('exportContentHashVersion must be an integer >= 1');
  }

  let frozenPrereqVersions: Readonly<Record<string, number>> | undefined;
  if (params.prerequisiteExportVersions !== undefined) {
    if (
      typeof params.prerequisiteExportVersions !== 'object' ||
      params.prerequisiteExportVersions === null
    ) {
      throw new InvalidBacklogMappingError('prerequisiteExportVersions must be an object');
    }
    const validatedPrereqs: Record<string, number> = {};
    for (const [key, val] of Object.entries(params.prerequisiteExportVersions)) {
      if (typeof val !== 'number' || !Number.isInteger(val) || val < 1) {
        throw new InvalidBacklogMappingError(
          `prerequisite export version for '${key}' must be an integer >= 1`
        );
      }
      validatedPrereqs[key] = val;
    }
    frozenPrereqVersions = Object.freeze(validatedPrereqs);
  }

  let frozenHistory: readonly BacklogExportHistoryEntry[] = Object.freeze([]);
  if (params.history !== undefined) {
    if (!Array.isArray(params.history)) {
      throw new InvalidBacklogMappingError('history must be an array');
    }
    const validatedHistory: BacklogExportHistoryEntry[] = [];
    let lastVersion = 0;
    for (const entry of params.history) {
      if (!entry || typeof entry !== 'object') {
        throw new InvalidBacklogMappingError('history entry must be an object');
      }
      if (
        typeof entry.exportVersion !== 'number' ||
        !Number.isInteger(entry.exportVersion) ||
        entry.exportVersion < 1
      ) {
        throw new InvalidBacklogMappingError('history entry exportVersion must be an integer >= 1');
      }
      if (entry.exportVersion >= exportVersion) {
        throw new InvalidBacklogMappingError(
          `history entry exportVersion (${entry.exportVersion}) must be strictly less than current mapping exportVersion (${exportVersion})`
        );
      }
      if (entry.exportVersion <= lastVersion) {
        throw new InvalidBacklogMappingError(
          'history entries must be strictly ordered by exportVersion ascending'
        );
      }
      lastVersion = entry.exportVersion;

      if (!entry.baselineId || typeof entry.baselineId !== 'string') {
        throw new InvalidBacklogMappingError('history entry baselineId must be a non-empty string');
      }
      if (
        typeof entry.storyVersion !== 'number' ||
        !Number.isInteger(entry.storyVersion) ||
        entry.storyVersion < 1
      ) {
        throw new InvalidBacklogMappingError('history entry storyVersion must be an integer >= 1');
      }
      if (!Array.isArray(entry.requirementRevisionIds)) {
        throw new InvalidBacklogMappingError(
          'history entry requirementRevisionIds must be an array'
        );
      }
      if (!entry.exportContentHash || !SHA256_REGEX.test(entry.exportContentHash)) {
        throw new InvalidBacklogMappingError(
          'history entry exportContentHash must be a valid 64-character SHA-256'
        );
      }
      if (!entry.exportedAt || typeof entry.exportedAt !== 'string') {
        throw new InvalidBacklogMappingError('history entry exportedAt must be a valid instant');
      }
      if (!entry.exportedBy || typeof entry.exportedBy !== 'string') {
        throw new InvalidBacklogMappingError('history entry exportedBy must be a non-empty string');
      }
      if (!entry.externalWorkItemId || typeof entry.externalWorkItemId !== 'string') {
        throw new InvalidBacklogMappingError(
          'history entry externalWorkItemId must be a non-empty string'
        );
      }

      let entryPrereqs: Readonly<Record<string, number>> | undefined;
      if (entry.prerequisiteExportVersions !== undefined) {
        if (
          typeof entry.prerequisiteExportVersions !== 'object' ||
          entry.prerequisiteExportVersions === null
        ) {
          throw new InvalidBacklogMappingError(
            'history entry prerequisiteExportVersions must be an object'
          );
        }
        const valMap: Record<string, number> = {};
        for (const [k, v] of Object.entries(entry.prerequisiteExportVersions)) {
          if (typeof v === 'number' && Number.isInteger(v) && v >= 1) {
            valMap[k] = v;
          }
        }
        entryPrereqs = Object.freeze(valMap);
      }

      validatedHistory.push(
        Object.freeze({
          exportVersion: entry.exportVersion,
          baselineId: createRequirementsBaselineId(entry.baselineId),
          storyVersion: entry.storyVersion,
          requirementRevisionIds: Object.freeze(
            entry.requirementRevisionIds.map((r: string) => createRequirementRevisionId(r))
          ),
          policyConstraintRevisionIds: entry.policyConstraintRevisionIds
            ? Object.freeze(
                entry.policyConstraintRevisionIds.map((p: string) =>
                  createPolicyConstraintRevisionId(p)
                )
              )
            : undefined,
          exportContentHash: entry.exportContentHash.toLowerCase(),
          exportContentHashVersion: entry.exportContentHashVersion ?? 1,
          prerequisiteExportVersions: entryPrereqs,
          exportedAt: createInstant(entry.exportedAt),
          exportedBy: createActorId(entry.exportedBy),
          externalWorkItemId: entry.externalWorkItemId.trim(),
          externalUrl: entry.externalUrl?.trim(),
          updateRationale: entry.updateRationale
        })
      );
    }
    frozenHistory = Object.freeze(validatedHistory);
  }

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
    storyVersion,
    exportVersion,
    exportContentHashVersion,
    baselineId,
    requirementRevisionIds: frozenReqRevs,
    policyConstraintRevisionIds: frozenPolicyRevs,
    prerequisiteExportVersions: frozenPrereqVersions,
    provider,
    externalContainer,
    externalWorkItemId,
    externalUrl,
    exportContentHash,
    exportedAt,
    exportedBy,
    metadata,
    history: frozenHistory
  });
}
