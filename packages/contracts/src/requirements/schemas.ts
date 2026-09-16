import { z } from 'zod';
import {
  REQUIREMENT_CATEGORIES,
  REQUIREMENT_ORIGINS,
  REQUIREMENT_REVIEW_STATES,
  REQUIREMENT_RESOLUTION_STATES,
  SOURCE_TYPES,
  FINDING_TYPES,
  FINDING_DISPOSITIONS,
  DISCOVERED_BY,
  isValidInstant
} from '@solutions-studio/domain';

export const InstantDtoSchema = z.string().refine(isValidInstant, {
  message: 'Invalid RFC 3339/ISO-8601 instant string with timezone and calendar validity'
});

export const SourceTypeSchema = z.enum(SOURCE_TYPES);
export const RequirementCategorySchema = z.enum(REQUIREMENT_CATEGORIES);
export const RequirementOriginSchema = z.enum(REQUIREMENT_ORIGINS);

export const EvidenceLocatorDtoSchema = z.string().min(1);

export const EvidenceReferenceDtoSchema = z.object({
  sourceRevisionId: z.string().min(1),
  locator: EvidenceLocatorDtoSchema
});

export const SourceDtoSchema = z.object({
  id: z.string().min(1),
  sourceType: SourceTypeSchema
});

export const RequirementDtoSchema = z.object({
  id: z.string().min(1)
});

export const SourceRevisionDtoSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  revision: z.number().int().positive(),
  contentHash: z.string().min(1),
  capturedAt: InstantDtoSchema,
  verifiedAt: InstantDtoSchema.optional(),
  supersedes: z.string().min(1).optional()
});

export const RequirementRevisionDtoSchema = z.object({
  id: z.string().min(1),
  requirementId: z.string().min(1),
  revision: z.number().int().positive(),
  statement: z.string().min(1),
  category: z.enum(REQUIREMENT_CATEGORIES),
  origin: z.enum(REQUIREMENT_ORIGINS),
  reviewState: z.enum(REQUIREMENT_REVIEW_STATES),
  resolutionState: z.enum(REQUIREMENT_RESOLUTION_STATES),
  evidence: z.array(EvidenceReferenceDtoSchema),
  rationale: z.string().optional(),
  affectedActors: z.array(z.string().min(1)).optional(),
  dependencies: z.array(z.string().min(1)).optional(),
  supersedes: z.string().min(1).optional()
});

export const RequirementsBaselineDtoSchema = z.object({
  id: z.string().min(1),
  requirementRevisions: z.array(z.string().min(1)),
  createdAt: InstantDtoSchema,
  createdBy: z.string().min(1)
});

export const CandidateFindingDtoSchema = z.object({
  id: z.string().min(1),
  type: z.enum(FINDING_TYPES),
  affectedRequirementRevisions: z.array(z.string().min(1)),
  evidence: z.array(EvidenceReferenceDtoSchema),
  discoveredBy: z.enum(DISCOVERED_BY),
  disposition: z.enum(FINDING_DISPOSITIONS),
  rationale: z.string().optional()
});
