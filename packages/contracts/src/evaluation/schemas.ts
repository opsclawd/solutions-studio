import { z } from 'zod';
import { FINDING_TYPES, FINDING_DISPOSITIONS, DISCOVERED_BY } from '@solutions-studio/domain';
import {
  EvidenceReferenceDtoSchema,
  InstantDtoSchema,
  RequirementCategorySchema,
  RequirementOriginSchema,
  SourceTypeSchema,
  CandidateRequirementDtoSchema,
  CandidateFindingResponseDtoSchema,
  CompiledRequirementsResponseDtoSchema
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
  'false-positive-near-conflict',
  'data-boundary-ambiguity',
  'subjective-normative-language'
] as const;

export const FixtureCategorySchema = z.enum(FIXTURE_CATEGORIES);

/**
 * Direct alias/re-export of EvidenceReferenceDtoSchema to guarantee that fixture
 * ground truth and the domain/contracts provenance contract never diverge.
 */
export const EvidenceExpectationDtoSchema = EvidenceReferenceDtoSchema;

export const CORPUS_VERSION_REGEX = /^v[0-9]+\.[0-9]+$/;

export const SafeFixtureIdSchema = z
  .string()
  .min(1)
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    'fixtureId must contain only alphanumeric characters, hyphens, and underscores without traversal segments'
  );

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
  fixtureId: SafeFixtureIdSchema,
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
  fixtureId: SafeFixtureIdSchema,
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

// --- Evaluation Runner & Report Schemas (Phase 1.6) ---

export const EVALUATION_REPORT_SCHEMA_VERSION = '1.0.0' as const;

export const createAvailableValueSchema = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.discriminatedUnion('status', [
    z.object({
      status: z.literal('available'),
      value: valueSchema
    }),
    z.object({
      status: z.literal('unavailable'),
      reason: z.string().min(1)
    })
  ]);

export const SourceLineageMapEntrySchema = z.object({
  declaredRevisionId: z.string().min(1),
  declaredSourceId: z.string().min(1),
  declaredOrdinal: z.number().int().positive(),
  declaredPredecessorAlias: z.string().min(1).optional(),
  capturedRevisionId: z.string().min(1),
  capturedSourceId: z.string().min(1),
  capturedOrdinal: z.number().int().positive(),
  capturedPredecessorId: z.string().min(1).optional(),
  contentHash: z.string().min(1)
});

export const ScoreCountersSchema = z
  .object({
    truePositives: z.number().int().nonnegative(),
    falsePositives: z.number().int().nonnegative(),
    falseNegatives: z.number().int().nonnegative(),
    precision: z.number().min(0).max(1).nullable(),
    recall: z.number().min(0).max(1).nullable(),
    f1Score: z.number().min(0).max(1).nullable()
  })
  .superRefine((data, ctx) => {
    const {
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      precision,
      recall,
      f1Score
    } = data;
    const expectedPrecision = tp + fp === 0 ? null : tp / (tp + fp);
    const expectedRecall = tp + fn === 0 ? null : tp / (tp + fn);
    const expectedF1 =
      expectedPrecision !== null &&
      expectedRecall !== null &&
      expectedPrecision + expectedRecall > 0
        ? (2 * expectedPrecision * expectedRecall) / (expectedPrecision + expectedRecall)
        : null;

    const EPSILON = 1e-4;

    if (expectedPrecision === null) {
      if (precision !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `precision must be null when TP+FP=0, received ${precision}`,
          path: ['precision']
        });
      }
    } else {
      if (precision === null || Math.abs(precision - expectedPrecision) > EPSILON) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `precision mismatch: expected ${expectedPrecision}, received ${precision}`,
          path: ['precision']
        });
      }
    }

    if (expectedRecall === null) {
      if (recall !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `recall must be null when TP+FN=0, received ${recall}`,
          path: ['recall']
        });
      }
    } else {
      if (recall === null || Math.abs(recall - expectedRecall) > EPSILON) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `recall mismatch: expected ${expectedRecall}, received ${recall}`,
          path: ['recall']
        });
      }
    }

    if (expectedF1 === null) {
      if (f1Score !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `f1Score must be null when precision or recall is null/zero, received ${f1Score}`,
          path: ['f1Score']
        });
      }
    } else {
      if (f1Score === null || Math.abs(f1Score - expectedF1) > EPSILON) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `f1Score mismatch: expected ${expectedF1}, received ${f1Score}`,
          path: ['f1Score']
        });
      }
    }
  });

export const RequirementMatchDetailSchema = z.object({
  expectedRequirementKey: z.string().min(1),
  observedRequirementRevisionId: z.string().min(1),
  category: RequirementCategorySchema,
  origin: RequirementOriginSchema,
  declaredEvidence: z.array(EvidenceExpectationDtoSchema).min(1),
  normalizedEvidence: z.array(EvidenceExpectationDtoSchema).min(1),
  observedEvidence: z.array(EvidenceExpectationDtoSchema).min(1),
  statement: z.string(),
  statementPatternDiagnostic: z
    .object({
      pattern: z.string(),
      matched: z.boolean()
    })
    .optional()
});

export const RequirementMismatchDetailSchema = z.object({
  type: z.enum(['missing-expected', 'unmatched-observed']),
  requirementKey: z.string().optional(),
  requirementRevisionId: z.string().optional(),
  category: RequirementCategorySchema,
  origin: RequirementOriginSchema.optional(),
  declaredEvidence: z.array(EvidenceExpectationDtoSchema).optional(),
  normalizedEvidence: z.array(EvidenceExpectationDtoSchema).optional(),
  observedEvidence: z.array(EvidenceExpectationDtoSchema).optional(),
  statement: z.string().optional(),
  reason: z.string().min(1)
});

export const FindingMatchDetailSchema = z.object({
  expectedFindingKey: z.string().min(1),
  observedFindingId: z.string().min(1),
  category: FixtureCategorySchema,
  type: FindingTypeSchema,
  declaredEvidence: z.array(EvidenceExpectationDtoSchema).min(1),
  normalizedEvidence: z.array(EvidenceExpectationDtoSchema).min(1),
  observedEvidence: z.array(EvidenceExpectationDtoSchema).min(1),
  relatedRequirementKeys: z.array(z.string()),
  rationale: z.string().optional()
});

export const FindingMismatchDetailSchema = z.object({
  type: z.enum(['missing-expected', 'matched-expected-non-finding', 'unclassified-observed']),
  findingKey: z.string().optional(),
  findingId: z.string().optional(),
  category: FixtureCategorySchema.optional(),
  domainType: FindingTypeSchema,
  declaredEvidence: z.array(EvidenceExpectationDtoSchema).optional(),
  normalizedEvidence: z.array(EvidenceExpectationDtoSchema).optional(),
  observedEvidence: z.array(EvidenceExpectationDtoSchema).optional(),
  relatedRequirementKeys: z.array(z.string()).optional(),
  affectedRequirementRevisions: z.array(z.string()).optional(),
  matchedNonFindingDescription: z.string().optional(),
  reason: z.string().min(1)
});

export const RejectedCompilerRequirementSchema = z.object({
  requirementKey: z.string().min(1),
  errorName: z.string().min(1),
  errorMessage: z.string().min(1),
  candidate: CandidateRequirementDtoSchema.optional()
});

export const RejectedCompilerFindingSchema = z.object({
  findingKey: z.string().min(1),
  errorName: z.string().min(1),
  errorMessage: z.string().min(1),
  candidate: CandidateFindingResponseDtoSchema.optional()
});

export const FixtureScorerResultSchema = z.object({
  requirementsByCategory: z.record(RequirementCategorySchema, ScoreCountersSchema),
  findingsByCategory: z.record(FixtureCategorySchema, ScoreCountersSchema),
  unclassifiedFindingsCount: z.number().int().nonnegative(),
  matchedRequirements: z.array(RequirementMatchDetailSchema),
  mismatchedRequirements: z.array(RequirementMismatchDetailSchema),
  matchedFindings: z.array(FindingMatchDetailSchema),
  mismatchedFindings: z.array(FindingMismatchDetailSchema),
  unclassifiedFindings: z.array(FindingMismatchDetailSchema),
  rejectedCompilerRequirements: z.array(RejectedCompilerRequirementSchema),
  rejectedCompilerFindings: z.array(RejectedCompilerFindingSchema)
});

export const GenerationTokensDtoSchema = z.object({
  input: z.number().int().nonnegative().optional(),
  output: z.number().int().nonnegative().optional(),
  thinking: z.number().int().nonnegative().optional(),
  total: z.number().int().nonnegative().optional()
});

export const GenerationMetadataDtoSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  tokens: GenerationTokensDtoSchema.optional(),
  raw: z.unknown().optional()
});

export const FixtureExecutionErrorSchema = z.object({
  name: z.string().min(1),
  message: z.string().min(1),
  phase: z.enum(['capture', 'compile', 'scoring'])
});

export const CompletedFixtureExecutedSchema = z.object({
  capturedSourceRevisionIds: z.array(z.string().min(1)),
  inputSourceRevisionIds: z.array(z.string().min(1)),
  acceptedRequirementRevisions: z.array(z.string().min(1)),
  acceptedFindingIds: z.array(z.string().min(1)),
  acceptedRequirementCount: z.number().int().nonnegative(),
  rejectedRequirementCount: z.number().int().nonnegative(),
  acceptedFindingCount: z.number().int().nonnegative(),
  rejectedFindingCount: z.number().int().nonnegative(),
  providerMetadata: createAvailableValueSchema(GenerationMetadataDtoSchema),
  rawResponse: CompiledRequirementsResponseDtoSchema.optional()
});

export const CompletedFixtureMeasuredSchema = z.object({
  durationMs: z.number().nonnegative(),
  score: FixtureScorerResultSchema
});

export const CompletedFixtureResultSchema = z.object({
  fixtureId: SafeFixtureIdSchema,
  status: z.literal('completed'),
  sourceLineageMap: z.array(SourceLineageMapEntrySchema),
  executed: CompletedFixtureExecutedSchema,
  measured: CompletedFixtureMeasuredSchema
});

export const FailedFixtureResultSchema = z.object({
  fixtureId: SafeFixtureIdSchema,
  status: z.literal('failed'),
  sourceLineageMap: z.array(SourceLineageMapEntrySchema).optional(),
  error: FixtureExecutionErrorSchema
});

export const EvaluationFixtureResultSchema = z
  .discriminatedUnion('status', [CompletedFixtureResultSchema, FailedFixtureResultSchema])
  .superRefine((data, ctx) => {
    if (data.status === 'completed') {
      const declaredSeen = new Set<string>();
      const capturedSeen = new Set<string>();
      const declaredToCaptured = new Map<string, string>();

      for (let i = 0; i < data.sourceLineageMap.length; i++) {
        const entry = data.sourceLineageMap[i];
        if (declaredSeen.has(entry.declaredRevisionId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate declaredRevisionId in sourceLineageMap: '${entry.declaredRevisionId}'`,
            path: ['sourceLineageMap', i, 'declaredRevisionId']
          });
        }
        declaredSeen.add(entry.declaredRevisionId);

        if (capturedSeen.has(entry.capturedRevisionId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate capturedRevisionId in sourceLineageMap: '${entry.capturedRevisionId}'`,
            path: ['sourceLineageMap', i, 'capturedRevisionId']
          });
        }
        capturedSeen.add(entry.capturedRevisionId);

        if (entry.declaredSourceId !== entry.capturedSourceId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `SourceId mismatch: declared '${entry.declaredSourceId}' but captured '${entry.capturedSourceId}'`,
            path: ['sourceLineageMap', i]
          });
        }

        if (entry.declaredOrdinal !== entry.capturedOrdinal) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Ordinal mismatch: declared ${entry.declaredOrdinal} but captured ${entry.capturedOrdinal}`,
            path: ['sourceLineageMap', i]
          });
        }

        if (entry.declaredPredecessorAlias === undefined) {
          if (entry.capturedPredecessorId !== undefined) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Predecessor mismatch: declared root has captured predecessor '${entry.capturedPredecessorId}'`,
              path: ['sourceLineageMap', i]
            });
          }
        } else {
          const expectedPredecessorCaptured = declaredToCaptured.get(
            entry.declaredPredecessorAlias
          );
          if (!expectedPredecessorCaptured) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Declared predecessor alias '${entry.declaredPredecessorAlias}' not found in prior entries`,
              path: ['sourceLineageMap', i]
            });
          } else if (entry.capturedPredecessorId !== expectedPredecessorCaptured) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Captured predecessor '${entry.capturedPredecessorId}' does not match translated predecessor '${expectedPredecessorCaptured}'`,
              path: ['sourceLineageMap', i]
            });
          }
        }

        declaredToCaptured.set(entry.declaredRevisionId, entry.capturedRevisionId);
      }
    }
  });

export const RollupMetricSchema = z.object({
  value: z.number().nonnegative(),
  contributingCompletedFixtureCount: z.number().int().nonnegative(),
  unavailableFixtureCount: z.number().int().nonnegative()
});

export const AggregateCategoryScoresSchema = z.object({
  totalFixtures: z.number().int().nonnegative(),
  completedFixtures: z.number().int().nonnegative(),
  failedFixtures: z.number().int().nonnegative(),
  requirementsByCategory: z.record(RequirementCategorySchema, ScoreCountersSchema),
  findingsByCategory: z.record(FixtureCategorySchema, ScoreCountersSchema),
  unclassifiedFindingsCount: z.number().int().nonnegative(),
  totalDurationMs: RollupMetricSchema.optional(),
  totalTokens: RollupMetricSchema.optional()
});

export const RequestedProvenanceSchema = z.object({
  candidateSha: createAvailableValueSchema(z.string()),
  providerMode: z.string().min(1),
  providerName: z.string().min(1),
  manifestPath: z.string().min(1),
  outputReportPath: createAvailableValueSchema(z.string()),
  storeDir: createAvailableValueSchema(z.string())
});

export const DeclaredSourceDeclarationSchema = z.object({
  sourceRevisionId: z.string().min(1),
  sourceId: z.string().min(1),
  sourceType: SourceTypeSchema,
  revision: z.number().int().positive(),
  contentHash: z.string().min(1),
  supersedes: z.string().min(1).optional()
});

export const DeclaredFixtureDeclarationSchema = z.object({
  fixtureId: SafeFixtureIdSchema,
  expectedJsonHash: z.string().min(1),
  sources: z.array(DeclaredSourceDeclarationSchema).min(1)
});

export const DeclaredProvenanceSchema = z.object({
  manifestVersion: z.string().min(1),
  manifestHash: z.string().min(1),
  canonicalizationVersion: z.string().min(1),
  corpusIdentity: z.string().min(1),
  fixtureOrder: z.array(SafeFixtureIdSchema),
  fixtures: z.array(DeclaredFixtureDeclarationSchema)
});

export const ConfiguredProvenanceSchema = z.object({
  compilerVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  gatewayConfig: z.record(z.string(), z.unknown()),
  nodeVersion: z.string().min(1),
  platform: z.string().min(1),
  arch: z.string().min(1)
});

export const VerifiedProvenanceSchema = z.object({
  schemaValidation: z.boolean(),
  corpusLineageValid: z.boolean(),
  persistenceVerified: z.boolean(),
  reportDigest: z.string().min(1)
});

export const ProvenanceLayersSchema = z.object({
  requested: RequestedProvenanceSchema,
  declared: DeclaredProvenanceSchema,
  configured: ConfiguredProvenanceSchema,
  verified: VerifiedProvenanceSchema
});

export const ReportArtifactsSchema = z.object({
  jsonReportPath: createAvailableValueSchema(z.string()),
  jsonReportDigest: createAvailableValueSchema(z.string()),
  markdownReportPath: createAvailableValueSchema(z.string()),
  markdownReportDigest: createAvailableValueSchema(z.string())
});

export const EvaluationReportSchema = z
  .object({
    reportSchemaVersion: z.literal(EVALUATION_REPORT_SCHEMA_VERSION),
    runId: z.string().min(1),
    executedAt: InstantDtoSchema,
    corpusVersion: z.string().regex(CORPUS_VERSION_REGEX),
    corpusIdentity: z.string().min(1),
    candidateSha: createAvailableValueSchema(z.string()),
    fixtureOrder: z.array(SafeFixtureIdSchema),
    fixtureResults: z.array(EvaluationFixtureResultSchema),
    aggregateScores: AggregateCategoryScoresSchema,
    reportArtifacts: ReportArtifactsSchema,
    provenance: ProvenanceLayersSchema
  })
  .superRefine((report, ctx) => {
    // 1. Check corpus identity consistency
    if (report.corpusIdentity !== report.provenance.declared.corpusIdentity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `report.corpusIdentity '${report.corpusIdentity}' does not match declared corpusIdentity '${report.provenance.declared.corpusIdentity}'`,
        path: ['corpusIdentity']
      });
    }

    // 2. Check corpus version consistency
    if (report.corpusVersion !== report.provenance.declared.manifestVersion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `report.corpusVersion '${report.corpusVersion}' does not match declared manifestVersion '${report.provenance.declared.manifestVersion}'`,
        path: ['corpusVersion']
      });
    }

    // 3. Check fixtureOrder uniqueness
    const orderSet = new Set<string>();
    for (let i = 0; i < report.fixtureOrder.length; i++) {
      const fId = report.fixtureOrder[i];
      if (orderSet.has(fId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate fixtureId in fixtureOrder: '${fId}'`,
          path: ['fixtureOrder', i]
        });
      }
      orderSet.add(fId);
    }

    // 4. Check fixtureOrder matches provenance.declared.fixtureOrder
    if (
      report.fixtureOrder.length !== report.provenance.declared.fixtureOrder.length ||
      report.fixtureOrder.some((f, idx) => f !== report.provenance.declared.fixtureOrder[idx])
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `fixtureOrder does not match declared fixtureOrder`,
        path: ['fixtureOrder']
      });
    }

    // 5. Check fixtureResults match fixtureOrder
    const resultFixtureIds = report.fixtureResults.map((r) => r.fixtureId);
    if (
      report.fixtureOrder.length !== resultFixtureIds.length ||
      report.fixtureOrder.some((f, idx) => f !== resultFixtureIds[idx])
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `fixtureResults order and IDs do not match fixtureOrder`,
        path: ['fixtureResults']
      });
    }

    // 6. Check aggregate counts match fixtureResults
    const total = report.fixtureResults.length;
    const completed = report.fixtureResults.filter((r) => r.status === 'completed').length;
    const failed = report.fixtureResults.filter((r) => r.status === 'failed').length;

    if (report.aggregateScores.totalFixtures !== total) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `aggregateScores.totalFixtures (${report.aggregateScores.totalFixtures}) does not match fixture count (${total})`,
        path: ['aggregateScores', 'totalFixtures']
      });
    }

    if (report.aggregateScores.completedFixtures !== completed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `aggregateScores.completedFixtures (${report.aggregateScores.completedFixtures}) does not match completed fixture count (${completed})`,
        path: ['aggregateScores', 'completedFixtures']
      });
    }

    if (report.aggregateScores.failedFixtures !== failed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `aggregateScores.failedFixtures (${report.aggregateScores.failedFixtures}) does not match failed fixture count (${failed})`,
        path: ['aggregateScores', 'failedFixtures']
      });
    }

    // 7. Check rollup bounds
    if (report.aggregateScores.totalDurationMs) {
      const dur = report.aggregateScores.totalDurationMs;
      if (dur.contributingCompletedFixtureCount > completed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `totalDurationMs contributing count (${dur.contributingCompletedFixtureCount}) exceeds completed fixtures (${completed})`,
          path: ['aggregateScores', 'totalDurationMs', 'contributingCompletedFixtureCount']
        });
      }
      if (dur.contributingCompletedFixtureCount + dur.unavailableFixtureCount !== completed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `totalDurationMs contributing count + unavailable count must equal completed fixtures (${completed})`,
          path: ['aggregateScores', 'totalDurationMs']
        });
      }
    }

    if (report.aggregateScores.totalTokens) {
      const tok = report.aggregateScores.totalTokens;
      if (tok.contributingCompletedFixtureCount > completed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `totalTokens contributing count (${tok.contributingCompletedFixtureCount}) exceeds completed fixtures (${completed})`,
          path: ['aggregateScores', 'totalTokens', 'contributingCompletedFixtureCount']
        });
      }
      if (tok.contributingCompletedFixtureCount + tok.unavailableFixtureCount !== completed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `totalTokens contributing count + unavailable count must equal completed fixtures (${completed})`,
          path: ['aggregateScores', 'totalTokens']
        });
      }
    }
  });

export const EvaluationRunRecordSchema = z
  .object({
    id: z.string().min(1),
    corpusVersion: z.string().regex(CORPUS_VERSION_REGEX),
    executedAt: InstantDtoSchema,
    fixtureResults: z.array(EvaluationFixtureResultSchema),
    report: EvaluationReportSchema
  })
  .superRefine((record, ctx) => {
    if (record.id !== record.report.runId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `EvaluationRunRecord.id '${record.id}' does not match report.runId '${record.report.runId}'`,
        path: ['id']
      });
    }
    if (record.corpusVersion !== record.report.corpusVersion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `EvaluationRunRecord.corpusVersion '${record.corpusVersion}' does not match report.corpusVersion '${record.report.corpusVersion}'`,
        path: ['corpusVersion']
      });
    }
    if (record.executedAt !== record.report.executedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `EvaluationRunRecord.executedAt '${record.executedAt}' does not match report.executedAt '${record.report.executedAt}'`,
        path: ['executedAt']
      });
    }
    if (
      record.fixtureResults.length !== record.report.fixtureResults.length ||
      record.fixtureResults.some(
        (f, idx) => f.fixtureId !== record.report.fixtureResults[idx].fixtureId
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `EvaluationRunRecord.fixtureResults do not match report.fixtureResults`,
        path: ['fixtureResults']
      });
    }
  });

function sortKeysRecursively(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sortKeysRecursively);
  }
  const record = obj as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = sortKeysRecursively(record[key]);
  }
  return sorted;
}

/**
 * Produces a deterministic canonical string representation of an EvaluationReportDto for hashing.
 * Excludes self-referential reportDigest and artifact digest values to ensure a non-circular digest projection.
 * Recursively sorts all object keys to guarantee identical projections across serialization formats.
 */
export function canonicalizeReportForDigest(
  report: z.input<typeof EvaluationReportSchema>
): string {
  const projected = JSON.parse(JSON.stringify(report)) as z.input<typeof EvaluationReportSchema>;
  projected.provenance.verified.reportDigest = '';
  if (projected.reportArtifacts.jsonReportDigest.status === 'available') {
    projected.reportArtifacts.jsonReportDigest = {
      status: 'available',
      value: ''
    };
  }
  return JSON.stringify(sortKeysRecursively(projected));
}
