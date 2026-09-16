import { z } from 'zod';
import { FINDING_TYPES, FINDING_DISPOSITIONS, DISCOVERED_BY } from '@solutions-studio/domain';
import {
  EvidenceReferenceDtoSchema,
  InstantDtoSchema,
  RequirementCategorySchema,
  RequirementOriginSchema,
  SourceTypeSchema
} from '../requirements/schemas.js';

export const FindingTypeSchema = z.enum(FINDING_TYPES);

export const FindingDispositionSchema = z.enum(FINDING_DISPOSITIONS);

export const DiscoveredBySchema = z.enum(DISCOVERED_BY);

export const FindingEvaluationDtoSchema = z.object({
  findingId: z.string().min(1),
  type: FindingTypeSchema,
  disposition: FindingDispositionSchema,
  discoveredBy: DiscoveredBySchema,
  rationale: z.string().optional()
});

export const FIXTURE_CATEGORIES = [
  'contradictory-approval-thresholds',
  'missing-actors-authorization',
  'incomplete-state-transitions',
  'missing-failure-recovery',
  'temporal-ambiguity',
  'undefined-cardinality',
  'unsupported-assumptions',
  'superseded-source-or-requirement',
  'source-authority-conflict',
  'false-positive-near-conflict'
] as const;

export const FixtureCategorySchema = z.enum(FIXTURE_CATEGORIES);

/**
 * Direct alias/re-export of EvidenceReferenceDtoSchema to guarantee that fixture
 * ground truth and the domain/contracts provenance contract never diverge.
 */
export const EvidenceExpectationDtoSchema = EvidenceReferenceDtoSchema;

export const CORPUS_VERSION_REGEX = /^v[0-9]+\.[0-9]+$/;

export const SafeRelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (p) =>
      !p.startsWith('/') &&
      !p.startsWith('\\') &&
      !/^[a-zA-Z]:[\\/]/.test(p) &&
      !p.split(/[/\\]/).includes('..'),
    { message: 'Path must be a relative path without traversal segments (..)' }
  );

export const EvaluationSourceDtoSchema = z.object({
  sourceRevisionId: z.string().min(1),
  sourceId: z.string().min(1),
  sourceType: SourceTypeSchema,
  revision: z.number().int().positive(),
  path: SafeRelativePathSchema,
  supersedes: z.string().min(1).optional()
});

export const ExpectedRequirementDtoSchema = z.object({
  requirementKey: z.string().min(1),
  category: RequirementCategorySchema,
  origin: RequirementOriginSchema,
  evidence: z.array(EvidenceExpectationDtoSchema).min(1),
  statementPattern: z.string().optional()
});

export const ExpectedFindingDtoSchema = z.object({
  findingKey: z.string().min(1),
  category: FixtureCategorySchema,
  type: FindingTypeSchema,
  evidence: z.array(EvidenceExpectationDtoSchema).min(1),
  relatedRequirementKeys: z.array(z.string()),
  rationale: z.string().optional()
});

export const ExpectedNonFindingDtoSchema = z.object({
  description: z.string().min(1),
  category: FixtureCategorySchema,
  wouldBeType: FindingTypeSchema,
  evidence: z.array(EvidenceExpectationDtoSchema).min(1)
});

export const EvaluationFixtureDtoSchema = z.object({
  fixtureId: z.string().min(1),
  version: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  categories: z.array(FixtureCategorySchema).min(1),
  canonicalMessyPackage: z.boolean().default(false),
  sources: z.array(EvaluationSourceDtoSchema).min(1),
  expectedRequirements: z.array(ExpectedRequirementDtoSchema),
  expectedFindings: z.array(ExpectedFindingDtoSchema),
  expectedNonFindings: z.array(ExpectedNonFindingDtoSchema)
});

export const EvaluationManifestEntryDtoSchema = z.object({
  fixtureId: z.string().min(1),
  path: SafeRelativePathSchema,
  categories: z.array(FixtureCategorySchema).min(1),
  canonicalMessyPackage: z.boolean().default(false)
});

export const EvaluationManifestDtoSchema = z.object({
  corpusVersion: z
    .string()
    .regex(
      CORPUS_VERSION_REGEX,
      'corpusVersion must adhere to the v<major>.<minor> format (e.g. v1.0)'
    ),
  generatedAt: InstantDtoSchema,
  fixtures: z.array(EvaluationManifestEntryDtoSchema)
});
