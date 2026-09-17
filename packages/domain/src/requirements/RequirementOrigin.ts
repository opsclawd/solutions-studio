export const REQUIREMENT_ORIGINS = [
  'EXPLICIT',
  'INFERRED',
  'ASSUMED',
  'GENERATED_PROPOSAL',
  'REVIEWER_PROPOSAL'
] as const;

export type RequirementOrigin = (typeof REQUIREMENT_ORIGINS)[number];

export const CANDIDATE_REQUIREMENT_ORIGINS = [
  'EXPLICIT',
  'INFERRED',
  'ASSUMED',
  'GENERATED_PROPOSAL'
] as const;

export type CandidateRequirementOrigin = (typeof CANDIDATE_REQUIREMENT_ORIGINS)[number];
