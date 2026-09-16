export const REQUIREMENT_RESOLUTION_STATES = [
  'CLEAR',
  'CONFLICTED',
  'UNRESOLVED',
  'SUPERSEDED'
] as const;

export type RequirementResolutionState = (typeof REQUIREMENT_RESOLUTION_STATES)[number];
