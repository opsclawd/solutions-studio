export const REQUIREMENT_REVIEW_STATES = ['PENDING', 'ACCEPTED', 'REJECTED'] as const;

export type RequirementReviewState = (typeof REQUIREMENT_REVIEW_STATES)[number];
