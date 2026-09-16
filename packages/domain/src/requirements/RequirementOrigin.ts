export const REQUIREMENT_ORIGINS = [
  'EXPLICIT',
  'INFERRED',
  'ASSUMED',
  'GENERATED_PROPOSAL',
  'REVIEWER_PROPOSAL'
] as const;

export type RequirementOrigin = (typeof REQUIREMENT_ORIGINS)[number];
