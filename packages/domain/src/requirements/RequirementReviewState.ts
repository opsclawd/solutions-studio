export const REQUIREMENT_REVIEW_STATES = ['PENDING', 'ACCEPTED', 'REJECTED'] as const;

export type RequirementReviewState = (typeof REQUIREMENT_REVIEW_STATES)[number];

export const REQUIREMENT_RECONCILIATION_ACTIONS = [
  'ACCEPT',
  'REJECT',
  'REVISE',
  'REOPEN',
  'RESOLVE'
] as const;

export type RequirementReconciliationAction = (typeof REQUIREMENT_RECONCILIATION_ACTIONS)[number];
