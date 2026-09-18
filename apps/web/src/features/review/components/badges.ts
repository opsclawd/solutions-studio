import type {
  RequirementOrigin,
  RequirementReviewState,
  RequirementResolutionState,
  FindingDisposition
} from '@solutions-studio/domain';

export interface BadgeStyle {
  label: string;
  className: string;
}

export function getOriginBadge(origin: RequirementOrigin): BadgeStyle {
  switch (origin) {
    case 'EXPLICIT':
      return {
        label: 'EXPLICIT',
        className: 'bg-emerald-100 text-emerald-800 border-emerald-300'
      };
    case 'GENERATED_PROPOSAL':
      return {
        label: 'CANDIDATE: GENERATED',
        className: 'bg-purple-100 text-purple-800 border-purple-300'
      };
    case 'INFERRED':
      return {
        label: 'CANDIDATE: INFERRED',
        className: 'bg-blue-100 text-blue-800 border-blue-300'
      };
    case 'ASSUMED':
      return {
        label: 'CANDIDATE: ASSUMED',
        className: 'bg-amber-100 text-amber-800 border-amber-300'
      };
    default:
      return {
        label: origin,
        className: 'bg-gray-100 text-gray-800 border-gray-300'
      };
  }
}

export function getReviewStateBadge(state: RequirementReviewState): BadgeStyle {
  switch (state) {
    case 'PENDING':
      return {
        label: 'PENDING REVIEW',
        className: 'bg-amber-100 text-amber-800 border-amber-300'
      };
    case 'ACCEPTED':
      return {
        label: 'ACCEPTED',
        className: 'bg-emerald-100 text-emerald-800 border-emerald-300'
      };
    case 'REJECTED':
      return {
        label: 'REJECTED',
        className: 'bg-rose-100 text-rose-800 border-rose-300'
      };
    default:
      return {
        label: state,
        className: 'bg-gray-100 text-gray-800 border-gray-300'
      };
  }
}

export function getResolutionStateBadge(state: RequirementResolutionState): BadgeStyle {
  switch (state) {
    case 'CLEAR':
      return {
        label: 'CLEAR',
        className: 'bg-emerald-100 text-emerald-800 border-emerald-300'
      };
    case 'CONFLICTED':
      return {
        label: 'CONFLICTED',
        className: 'bg-rose-100 text-rose-800 border-rose-300'
      };
    case 'UNRESOLVED':
      return {
        label: 'UNRESOLVED',
        className: 'bg-amber-100 text-amber-800 border-amber-300'
      };
    case 'SUPERSEDED':
      return {
        label: 'SUPERSEDED',
        className: 'bg-gray-100 text-gray-800 border-gray-300'
      };
    default:
      return {
        label: state,
        className: 'bg-gray-100 text-gray-800 border-gray-300'
      };
  }
}

export function getDispositionBadge(disposition: FindingDisposition): BadgeStyle {
  switch (disposition) {
    case 'OPEN':
      return {
        label: 'OPEN',
        className: 'bg-rose-100 text-rose-800 border-rose-300'
      };
    case 'RESOLVED':
      return {
        label: 'RESOLVED',
        className: 'bg-emerald-100 text-emerald-800 border-emerald-300'
      };
    case 'DISMISSED_FALSE_POSITIVE':
      return {
        label: 'DISMISSED (FALSE POSITIVE)',
        className: 'bg-gray-100 text-gray-800 border-gray-300'
      };
    case 'ACCEPTED_RISK':
      return {
        label: 'ACCEPTED RISK',
        className: 'bg-purple-100 text-purple-800 border-purple-300'
      };
    default:
      return {
        label: disposition,
        className: 'bg-gray-100 text-gray-800 border-gray-300'
      };
  }
}
