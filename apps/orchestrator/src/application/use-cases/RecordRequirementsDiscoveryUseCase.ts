import { randomUUID } from 'node:crypto';
import {
  createRequirementRevision,
  createCandidateFinding,
  createRequirementId,
  createRequirementRevisionId,
  createFindingId,
  createRequirementsBaselineId,
  createSourceRevisionId,
  createEvidenceLocator,
  createActorId,
  REQUIREMENT_CATEGORIES,
  FINDING_TYPES,
  DomainError,
  type RequirementRevision,
  type CandidateFinding,
  type RequirementCategory,
  type FindingType,
  type RequirementsBaselineId,
  type RequirementId,
  type RequirementRevisionId,
  type FindingId
} from '@solutions-studio/domain';
import type { IRequirementsRepository } from '../ports/persistence/IRequirementsRepository.js';
import {
  RationaleRequiredError,
  UnknownRequirementsBaselineError,
  UnknownRequirementRevisionError
} from './ReconciliationErrors.js';
import { UnknownSourceRevisionError, UnresolvedLocatorError } from './CompileRequirementsErrors.js';
import {
  UnknownProjectionError,
  ProjectionBaselineMismatchError,
  RequirementAlreadyExistsError
} from './DiscoveryErrors.js';

export interface RecordRequirementDiscoveryInput {
  readonly statement: string;
  readonly category: RequirementCategory;
  readonly rationale: string;
  readonly actorId?: string;
  readonly baselineId?: string;
  readonly originatingProjectionId?: string;
  readonly affectedActors?: readonly string[];
  readonly dependencies?: readonly string[];
  readonly evidence?: readonly {
    readonly sourceRevisionId: string;
    readonly locator: string;
  }[];
  readonly requirementId?: string;
  readonly revisionId?: string;
}

export interface RecordFindingDiscoveryInput {
  readonly type: FindingType;
  readonly discoveredBy: 'human' | 'artifact-validation';
  readonly rationale: string;
  readonly actorId?: string;
  readonly baselineId?: string;
  readonly originatingProjectionId?: string;
  readonly affectedRequirementRevisions?: readonly string[];
  readonly evidence?: readonly {
    readonly sourceRevisionId: string;
    readonly locator: string;
  }[];
  readonly findingId?: string;
}

function assertSafeIdentifier(id: string, name: string): string {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new DomainError(`Invalid ${name}: identifier cannot be empty`);
  }
  const trimmed = id.trim();
  if (
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('..') ||
    trimmed.includes('\0')
  ) {
    throw new DomainError(
      `Invalid ${name} '${id}': cannot contain path separators or traversal sequences`
    );
  }
  return trimmed;
}

export class RecordRequirementsDiscoveryUseCase {
  constructor(private readonly repository: IRequirementsRepository) {}

  async recordRequirementDiscovery(
    input: RecordRequirementDiscoveryInput
  ): Promise<RequirementRevision> {
    if (typeof input.statement !== 'string' || input.statement.trim().length === 0) {
      throw new DomainError('Requirement statement must be a non-empty string');
    }

    if (typeof input.rationale !== 'string' || input.rationale.trim().length === 0) {
      throw new RationaleRequiredError('A non-empty rationale is required');
    }

    if (!REQUIREMENT_CATEGORIES.includes(input.category)) {
      throw new DomainError(`Invalid RequirementCategory: '${String(input.category)}'`);
    }

    const actorId = input.actorId
      ? createActorId(assertSafeIdentifier(input.actorId, 'actorId'))
      : undefined;

    let resolvedBaselineId: RequirementsBaselineId | undefined = undefined;
    if (input.originatingProjectionId) {
      assertSafeIdentifier(input.originatingProjectionId, 'originatingProjectionId');
      const projection = await this.repository.getProjectionRecord(input.originatingProjectionId);
      if (!projection) {
        throw new UnknownProjectionError(input.originatingProjectionId);
      }
      if (input.baselineId) {
        assertSafeIdentifier(input.baselineId, 'baselineId');
        if (projection.baselineId !== input.baselineId) {
          throw new ProjectionBaselineMismatchError(
            input.originatingProjectionId,
            projection.baselineId,
            input.baselineId
          );
        }
      }
      resolvedBaselineId = input.baselineId
        ? createRequirementsBaselineId(input.baselineId)
        : projection.baselineId;
    } else if (input.baselineId) {
      assertSafeIdentifier(input.baselineId, 'baselineId');
      const baselineId = createRequirementsBaselineId(input.baselineId);
      const baseline = await this.repository.getRequirementsBaseline(baselineId);
      if (!baseline) {
        throw new UnknownRequirementsBaselineError(input.baselineId);
      }
      resolvedBaselineId = baseline.id;
    }

    if (input.dependencies) {
      for (const depId of input.dependencies) {
        assertSafeIdentifier(depId, 'dependency');
        const revs = await this.repository.listRequirementRevisions(createRequirementId(depId));
        if (revs.length === 0) {
          throw new UnknownRequirementRevisionError(depId);
        }
      }
    }

    if (input.evidence) {
      for (const ref of input.evidence) {
        assertSafeIdentifier(ref.sourceRevisionId, 'sourceRevisionId');
        const srcRev = await this.repository.getSourceRevision(
          createSourceRevisionId(ref.sourceRevisionId)
        );
        if (!srcRev) {
          throw new UnknownSourceRevisionError(ref.sourceRevisionId);
        }
        const loc = await this.repository.resolveLocator(
          createSourceRevisionId(ref.sourceRevisionId),
          ref.locator
        );
        if (!loc) {
          throw new UnresolvedLocatorError(ref.sourceRevisionId, ref.locator);
        }
      }
    }

    let requirementId: RequirementId;
    if (input.requirementId) {
      assertSafeIdentifier(input.requirementId, 'requirementId');
      requirementId = createRequirementId(input.requirementId);
      const existingRevisions = await this.repository.listRequirementRevisions(requirementId);
      if (existingRevisions.length > 0) {
        throw new RequirementAlreadyExistsError(input.requirementId);
      }
    } else {
      requirementId = createRequirementId(`REQ-${randomUUID()}`);
    }

    let revisionId: RequirementRevisionId;
    if (input.revisionId) {
      assertSafeIdentifier(input.revisionId, 'revisionId');
      revisionId = createRequirementRevisionId(input.revisionId);
    } else {
      revisionId = createRequirementRevisionId(`${requirementId}-R1`);
    }

    const revision = createRequirementRevision({
      id: revisionId,
      requirementId,
      revision: 1,
      statement: input.statement.trim(),
      category: input.category,
      origin: 'REVIEWER_PROPOSAL',
      reviewState: 'PENDING',
      resolutionState: 'UNRESOLVED',
      evidence: input.evidence?.map((e) => ({
        sourceRevisionId: createSourceRevisionId(e.sourceRevisionId),
        locator: createEvidenceLocator(e.locator)
      })),
      rationale: input.rationale.trim(),
      actorId,
      baselineId: resolvedBaselineId,
      originatingProjectionId: input.originatingProjectionId,
      affectedActors: input.affectedActors?.map((a) =>
        createActorId(assertSafeIdentifier(a, 'affectedActor'))
      ),
      dependencies: input.dependencies?.map((d) =>
        createRequirementId(assertSafeIdentifier(d, 'dependency'))
      )
    });

    await this.repository.saveRequirementRevision(revision);
    return revision;
  }

  async recordFindingDiscovery(input: RecordFindingDiscoveryInput): Promise<CandidateFinding> {
    if (typeof input.rationale !== 'string' || input.rationale.trim().length === 0) {
      throw new RationaleRequiredError('A non-empty rationale is required');
    }

    if (input.discoveredBy !== 'human' && input.discoveredBy !== 'artifact-validation') {
      throw new DomainError(
        `Invalid discoveredBy: '${String(input.discoveredBy)}'. Must be 'human' or 'artifact-validation'.`
      );
    }

    if (!FINDING_TYPES.includes(input.type)) {
      throw new DomainError(`Invalid FindingType: '${String(input.type)}'`);
    }

    const actorId = input.actorId
      ? createActorId(assertSafeIdentifier(input.actorId, 'actorId'))
      : undefined;

    let resolvedBaselineId: RequirementsBaselineId | undefined = undefined;
    if (input.originatingProjectionId) {
      assertSafeIdentifier(input.originatingProjectionId, 'originatingProjectionId');
      const projection = await this.repository.getProjectionRecord(input.originatingProjectionId);
      if (!projection) {
        throw new UnknownProjectionError(input.originatingProjectionId);
      }
      if (input.baselineId) {
        assertSafeIdentifier(input.baselineId, 'baselineId');
        if (projection.baselineId !== input.baselineId) {
          throw new ProjectionBaselineMismatchError(
            input.originatingProjectionId,
            projection.baselineId,
            input.baselineId
          );
        }
      }
      resolvedBaselineId = input.baselineId
        ? createRequirementsBaselineId(input.baselineId)
        : projection.baselineId;
    } else if (input.baselineId) {
      assertSafeIdentifier(input.baselineId, 'baselineId');
      const baselineId = createRequirementsBaselineId(input.baselineId);
      const baseline = await this.repository.getRequirementsBaseline(baselineId);
      if (!baseline) {
        throw new UnknownRequirementsBaselineError(input.baselineId);
      }
      resolvedBaselineId = baseline.id;
    }

    if (input.affectedRequirementRevisions) {
      for (const revId of input.affectedRequirementRevisions) {
        assertSafeIdentifier(revId, 'affectedRequirementRevision');
        const rev = await this.repository.getRequirementRevision(
          createRequirementRevisionId(revId)
        );
        if (!rev) {
          throw new UnknownRequirementRevisionError(revId);
        }
      }
    }

    if (input.evidence) {
      for (const ref of input.evidence) {
        assertSafeIdentifier(ref.sourceRevisionId, 'sourceRevisionId');
        const srcRev = await this.repository.getSourceRevision(
          createSourceRevisionId(ref.sourceRevisionId)
        );
        if (!srcRev) {
          throw new UnknownSourceRevisionError(ref.sourceRevisionId);
        }
        const loc = await this.repository.resolveLocator(
          createSourceRevisionId(ref.sourceRevisionId),
          ref.locator
        );
        if (!loc) {
          throw new UnresolvedLocatorError(ref.sourceRevisionId, ref.locator);
        }
      }
    }

    let findingId: FindingId;
    if (input.findingId) {
      assertSafeIdentifier(input.findingId, 'findingId');
      findingId = createFindingId(input.findingId);
    } else {
      findingId = createFindingId(`FINDING-${randomUUID()}`);
    }

    const finding = createCandidateFinding({
      id: findingId,
      type: input.type,
      affectedRequirementRevisions: input.affectedRequirementRevisions?.map((r) =>
        createRequirementRevisionId(assertSafeIdentifier(r, 'affectedRequirementRevision'))
      ),
      evidence: input.evidence?.map((e) => ({
        sourceRevisionId: createSourceRevisionId(e.sourceRevisionId),
        locator: createEvidenceLocator(e.locator)
      })),
      discoveredBy: input.discoveredBy,
      disposition: 'OPEN',
      rationale: input.rationale.trim(),
      actorId,
      baselineId: resolvedBaselineId,
      originatingProjectionId: input.originatingProjectionId
    });

    await this.repository.saveCandidateFinding(finding);
    return finding;
  }
}
