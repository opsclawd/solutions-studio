import { ZodError } from 'zod';
import {
  DomainError,
  EmptyBaselineError,
  FindingRationaleRequiredError
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
  UnknownRequirementsBaselineError
} from '../application/use-cases/ReconciliationErrors.js';
import { RepairRetryExhaustionError } from '../application/use-cases/RepairErrors.js';

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

  if (error instanceof InvalidTransitionError || error instanceof AlreadyClearError) {
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
