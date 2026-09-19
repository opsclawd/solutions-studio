import { ZodError } from 'zod';
import {
  DomainError,
  EmptyBaselineError,
  FindingRationaleRequiredError,
  InvalidBaselineMembershipError
} from '@solutions-studio/domain';
import type { ApiErrorDto } from '@solutions-studio/contracts';
import {
  AlreadyClearError,
  BlockedByOpenFindingsError,
  InvalidTransitionError,
  RationaleRequiredError,
  StaleRevisionTargetError,
  UnauditedFindingDispositionError,
  UnauditedRequirementRevisionError,
  UnknownCandidateFindingError,
  UnknownRequirementRevisionError,
  UnknownRequirementsBaselineError,
  UnknownPolicyConstraintRevisionError,
  UnknownEngineeringDecisionError,
  InvalidEngineeringDecisionStateError
} from '../application/use-cases/ReconciliationErrors.js';
import { RepairRetryExhaustionError } from '../application/use-cases/RepairErrors.js';
import { PrototypeProvenanceValidationError } from '../application/use-cases/PrototypeProjectionErrors.js';
import {
  SqlProvenanceValidationError,
  UnacceptedEngineeringDecisionError,
  SqlExecutionValidationError
} from '../application/use-cases/SqlSchemaProjectionErrors.js';
import {
  OpenApiProvenanceValidationError,
  OpenApiStructuralValidationError
} from '../application/use-cases/OpenApiProjectionErrors.js';
import {
  StoryProvenanceValidationError,
  GherkinSyntaxValidationError,
  UnknownStoryError
} from '../application/use-cases/StoryProjectionErrors.js';
import {
  UnknownProjectionError,
  ProjectionBaselineMismatchError,
  ProjectionArtifactTypeMismatchError,
  ConflictingSqlProjectionAuthorityError,
  RequirementAlreadyExistsError
} from '../application/use-cases/DiscoveryErrors.js';
import {
  UnknownSourceRevisionError,
  UnresolvedLocatorError
} from '../application/use-cases/CompileRequirementsErrors.js';
import { ImmutableRecordConflictError } from '../application/ports/persistence/IRequirementsRepository.js';

export interface MappedErrorResponse {
  readonly statusCode: number;
  readonly body: ApiErrorDto;
}

export function mapErrorToResponse(error: unknown): MappedErrorResponse {
  if (error instanceof ZodError || (error as { name?: string }).name === 'ZodError') {
    const issues = (error as ZodError).issues ?? [];
    return {
      statusCode: 400,
      body: {
        code: 'VALIDATION_ERROR',
        message: issues.length > 0 ? issues.map((i) => i.message).join('; ') : 'Validation failed',
        details: issues
      }
    };
  }

  // Fastify validation errors
  if ((error as { validation?: unknown; statusCode?: number }).validation) {
    const err = error as { message: string; validation: unknown };
    return {
      statusCode: 400,
      body: {
        code: 'VALIDATION_ERROR',
        message: err.message || 'Validation failed',
        details: err.validation
      }
    };
  }

  if (error instanceof RationaleRequiredError || error instanceof FindingRationaleRequiredError) {
    return {
      statusCode: 400,
      body: {
        code: 'RATIONALE_REQUIRED',
        message: error.message
      }
    };
  }

  if (error instanceof EmptyBaselineError) {
    return {
      statusCode: 400,
      body: {
        code: 'EMPTY_BASELINE',
        message: error.message
      }
    };
  }

  if (error instanceof UnknownRequirementRevisionError) {
    return {
      statusCode: 404,
      body: {
        code: 'REQUIREMENT_REVISION_NOT_FOUND',
        message: error.message,
        details: { revisionId: error.revisionId }
      }
    };
  }

  if (error instanceof UnknownCandidateFindingError) {
    return {
      statusCode: 404,
      body: {
        code: 'FINDING_NOT_FOUND',
        message: error.message,
        details: { findingId: error.findingId }
      }
    };
  }

  if (error instanceof UnknownRequirementsBaselineError) {
    return {
      statusCode: 404,
      body: {
        code: 'BASELINE_NOT_FOUND',
        message: error.message,
        details: { baselineId: error.baselineId }
      }
    };
  }

  if (error instanceof UnknownPolicyConstraintRevisionError) {
    return {
      statusCode: 404,
      body: {
        code: 'POLICY_CONSTRAINT_NOT_FOUND',
        message: error.message,
        details: { revisionId: error.revisionId }
      }
    };
  }

  if (error instanceof UnknownEngineeringDecisionError) {
    return {
      statusCode: 404,
      body: {
        code: 'ENGINEERING_DECISION_NOT_FOUND',
        message: error.message,
        details: { decisionId: error.decisionId }
      }
    };
  }

  if (error instanceof UnknownProjectionError) {
    return {
      statusCode: 404,
      body: {
        code: 'PROJECTION_NOT_FOUND',
        message: error.message,
        details: { projectionId: error.projectionId }
      }
    };
  }

  if (error instanceof UnknownSourceRevisionError) {
    return {
      statusCode: 404,
      body: {
        code: 'SOURCE_REVISION_NOT_FOUND',
        message: error.message,
        details: { sourceRevisionId: error.sourceRevisionId }
      }
    };
  }

  if (error instanceof ProjectionBaselineMismatchError) {
    return {
      statusCode: 400,
      body: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: {
          projectionId: error.projectionId,
          baselineId: error.expectedBaselineId,
          projectionBaselineId: error.projectionBaselineId
        }
      }
    };
  }

  if (error instanceof ProjectionArtifactTypeMismatchError) {
    return {
      statusCode: 400,
      body: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: {
          projectionId: error.projectionId,
          artifactType: error.projectionArtifactType,
          expectedArtifactType: error.expectedArtifactType
        }
      }
    };
  }

  if (error instanceof ConflictingSqlProjectionAuthorityError) {
    return {
      statusCode: 409,
      body: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: {
          projectionId: error.projectionId,
          decisionId: error.decisionId
        }
      }
    };
  }

  if (error instanceof UnresolvedLocatorError) {
    return {
      statusCode: 400,
      body: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: {
          sourceRevisionId: error.sourceRevisionId,
          locator: error.locator
        }
      }
    };
  }

  if (error instanceof StaleRevisionTargetError) {
    return {
      statusCode: 409,
      body: {
        code: 'STALE_REVISION_TARGET',
        message: error.message,
        details: {
          revisionId: error.revisionId,
          latestRevisionId: error.latestRevisionId
        }
      }
    };
  }

  if (error instanceof RequirementAlreadyExistsError) {
    return {
      statusCode: 409,
      body: {
        code: 'INVALID_TRANSITION',
        message: error.message,
        details: { requirementId: error.requirementId }
      }
    };
  }

  if (error instanceof ImmutableRecordConflictError) {
    return {
      statusCode: 409,
      body: {
        code: 'INVALID_TRANSITION',
        message: error.message,
        details: { recordPath: error.recordPath }
      }
    };
  }

  if (
    error instanceof InvalidTransitionError ||
    error instanceof AlreadyClearError ||
    error instanceof InvalidEngineeringDecisionStateError
  ) {
    return {
      statusCode: 409,
      body: {
        code: 'INVALID_TRANSITION',
        message: error.message
      }
    };
  }

  if (error instanceof BlockedByOpenFindingsError) {
    return {
      statusCode: 409,
      body: {
        code: 'BLOCKED_BY_OPEN_FINDINGS',
        message: error.message,
        details: {
          blockingFindings: error.blockingFindings.map((b) => ({
            findingId: b.id,
            matchedRevisionId: b.matchedRevisionId,
            proposedRevisionId: b.proposedRevisionId,
            type: b.type,
            disposition: b.disposition
          }))
        }
      }
    };
  }

  if (
    error instanceof UnauditedRequirementRevisionError ||
    error instanceof UnauditedFindingDispositionError
  ) {
    return {
      statusCode: 409,
      body: {
        code: 'UNAUDITED_RECONCILIATION',
        message: error.message
      }
    };
  }

  if (error instanceof PrototypeProvenanceValidationError) {
    return {
      statusCode: 400,
      body: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: {
          baselineId: error.baselineId,
          invalidRequirementRevisionIds: error.invalidRequirementRevisionIds,
          allowedRequirementRevisionIds: error.allowedRequirementRevisionIds
        }
      }
    };
  }

  if (error instanceof SqlProvenanceValidationError) {
    return {
      statusCode: 400,
      body: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: {
          baselineId: error.baselineId,
          invalidRequirementRevisionIds: error.invalidRequirementRevisionIds,
          allowedRequirementRevisionIds: error.allowedRequirementRevisionIds,
          invalidPolicyConstraintRevisionIds: error.invalidPolicyConstraintRevisionIds,
          allowedPolicyConstraintRevisionIds: error.allowedPolicyConstraintRevisionIds,
          invalidEngineeringDecisionIds: error.invalidEngineeringDecisionIds,
          allowedEngineeringDecisionIds: error.allowedEngineeringDecisionIds
        }
      }
    };
  }

  if (error instanceof UnacceptedEngineeringDecisionError) {
    return {
      statusCode: 400,
      body: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: {
          decisionId: error.decisionId,
          state: error.state,
          baselineId: error.baselineId
        }
      }
    };
  }

  if (error instanceof SqlExecutionValidationError) {
    return {
      statusCode: 400,
      body: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: error.errorDetails
      }
    };
  }

  if (error instanceof OpenApiProvenanceValidationError) {
    return {
      statusCode: 400,
      body: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: {
          baselineId: error.baselineId,
          invalidRequirementRevisionIds: error.invalidRequirementRevisionIds,
          allowedRequirementRevisionIds: error.allowedRequirementRevisionIds,
          invalidPolicyConstraintRevisionIds: error.invalidPolicyConstraintRevisionIds,
          allowedPolicyConstraintRevisionIds: error.allowedPolicyConstraintRevisionIds,
          invalidEngineeringDecisionIds: error.invalidEngineeringDecisionIds,
          allowedEngineeringDecisionIds: error.allowedEngineeringDecisionIds
        }
      }
    };
  }

  if (error instanceof OpenApiStructuralValidationError) {
    return {
      statusCode: 400,
      body: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: error.errorDetails
      }
    };
  }

  if (error instanceof UnknownStoryError) {
    return {
      statusCode: 404,
      body: {
        code: 'STORY_NOT_FOUND',
        message: error.message,
        details: { storyId: error.storyId }
      }
    };
  }

  if (error instanceof StoryProvenanceValidationError) {
    return {
      statusCode: 400,
      body: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: {
          baselineId: error.baselineId,
          invalidRequirementRevisionIds: error.invalidRequirementRevisionIds,
          allowedRequirementRevisionIds: error.allowedRequirementRevisionIds,
          invalidPolicyConstraintRevisionIds: error.invalidPolicyConstraintRevisionIds,
          allowedPolicyConstraintRevisionIds: error.allowedPolicyConstraintRevisionIds
        }
      }
    };
  }

  if (error instanceof GherkinSyntaxValidationError) {
    return {
      statusCode: 400,
      body: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: error.errorDetails
      }
    };
  }

  if (error instanceof RepairRetryExhaustionError) {
    return {
      statusCode: 502,
      body: {
        code: 'ARTIFACT_GENERATION_FAILED',
        message: error.message,
        details: {
          attempts: error.attempts,
          errors: error.errors
        }
      }
    };
  }

  if (error instanceof InvalidBaselineMembershipError) {
    return {
      statusCode: 400,
      body: {
        code: 'INVALID_BASELINE_MEMBERSHIP',
        message: error.message,
        details: {
          violations: error.violations
        }
      }
    };
  }

  if (error instanceof DomainError) {
    return {
      statusCode: 400,
      body: {
        code: 'VALIDATION_ERROR',
        message: error.message
      }
    };
  }

  // Fallback for unknown / unexpected errors
  return {
    statusCode: 500,
    body: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error'
    }
  };
}
