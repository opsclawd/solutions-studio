import { describe, it, expect } from 'vitest';
import { FINDING_TYPES, FINDING_DISPOSITIONS, DISCOVERED_BY } from '@solutions-studio/domain';
import { EvidenceReferenceDtoSchema } from '../../src/requirements/schemas.js';
import {
  FindingTypeSchema,
  FindingDispositionSchema,
  DiscoveredBySchema,
  FindingEvaluationDtoSchema,
  FIXTURE_CATEGORIES,
  FixtureCategorySchema,
  EvidenceExpectationDtoSchema,
  EvaluationSourceDtoSchema,
  ExpectedRequirementDtoSchema,
  ExpectedFindingDtoSchema,
  ExpectedNonFindingDtoSchema,
  EvaluationFixtureDtoSchema,
  EvaluationManifestDtoSchema,
  CORPUS_VERSION_REGEX,
  SafeRelativePathSchema,
  SafeFixtureIdSchema,
  SourceLineageMapEntrySchema,
  ScoreCountersSchema,
  EvaluationFixtureResultSchema,
  EvaluationReportSchema,
  EvaluationRunRecordSchema,
  canonicalizeReportForDigest
} from '../../src/evaluation/index.js';

describe('Evaluation Contract Schemas', () => {
  it('FindingTypeSchema round-trips against domain FINDING_TYPES', () => {
    for (const type of FINDING_TYPES) {
      expect(FindingTypeSchema.parse(type)).toBe(type);
    }
    expect(() => FindingTypeSchema.parse('non-existent-type')).toThrow();
  });

  it('FindingDispositionSchema round-trips against domain FINDING_DISPOSITIONS', () => {
    for (const disposition of FINDING_DISPOSITIONS) {
      expect(FindingDispositionSchema.parse(disposition)).toBe(disposition);
    }
    expect(() => FindingDispositionSchema.parse('UNKNOWN_DISPOSITION')).toThrow();
  });

  it('DiscoveredBySchema round-trips against domain DISCOVERED_BY', () => {
    for (const discoveredBy of DISCOVERED_BY) {
      expect(DiscoveredBySchema.parse(discoveredBy)).toBe(discoveredBy);
    }
    expect(() => DiscoveredBySchema.parse('alien')).toThrow();
  });

  it('FindingEvaluationDtoSchema validates valid evaluation DTO and rejects invalid', () => {
    const valid = {
      findingId: 'FINDING-01',
      type: 'missing-authorization',
      disposition: 'RESOLVED',
      discoveredBy: 'heuristic',
      rationale: 'Auditable explanation'
    };
    const parsed = FindingEvaluationDtoSchema.parse(valid);
    expect(parsed).toEqual(valid);

    expect(() =>
      FindingEvaluationDtoSchema.parse({
        findingId: '',
        type: 'missing-authorization',
        disposition: 'RESOLVED',
        discoveredBy: 'heuristic'
      })
    ).toThrow();
  });

  it('FIXTURE_CATEGORIES contains exactly the 10 issue-mandated categories', () => {
    const expected = [
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
    ];
    expect(FIXTURE_CATEGORIES).toEqual(expected);
    expect(FIXTURE_CATEGORIES).toHaveLength(10);
  });

  it('FixtureCategorySchema round-trips all categories and rejects invalid', () => {
    for (const cat of FIXTURE_CATEGORIES) {
      expect(FixtureCategorySchema.parse(cat)).toBe(cat);
    }
    expect(() => FixtureCategorySchema.parse('unknown-defect')).toThrow();
  });

  it('EvidenceExpectationDtoSchema is reference-identical to EvidenceReferenceDtoSchema', () => {
    expect(EvidenceExpectationDtoSchema).toBe(EvidenceReferenceDtoSchema);
  });

  it('EvidenceExpectationDtoSchema requires sourceRevisionId and rejects sourceId-only payloads', () => {
    const valid = {
      sourceRevisionId: 'SOP-001-R1',
      locator: 'clause-2.1'
    };
    expect(EvidenceExpectationDtoSchema.parse(valid)).toEqual(valid);

    // Rejects payload missing sourceRevisionId (e.g. regression to { sourceId, locator })
    expect(() =>
      EvidenceExpectationDtoSchema.parse({
        sourceId: 'SOP-001',
        locator: 'clause-2.1'
      })
    ).toThrow();
  });

  it('EvaluationSourceDtoSchema validates valid source and rejects missing path or invalid revision', () => {
    const valid = {
      sourceRevisionId: 'SOP-001-R1',
      sourceId: 'SOP-001',
      sourceType: 'sop',
      revision: 1,
      path: 'source.1.md'
    };
    expect(EvaluationSourceDtoSchema.parse(valid)).toEqual(valid);

    // With supersedes
    const withSupersedes = {
      sourceRevisionId: 'SOP-001-R2',
      sourceId: 'SOP-001',
      sourceType: 'sop',
      revision: 2,
      path: 'source.2.md',
      supersedes: 'SOP-001-R1'
    };
    expect(EvaluationSourceDtoSchema.parse(withSupersedes)).toEqual(withSupersedes);

    // Missing path
    expect(() =>
      EvaluationSourceDtoSchema.parse({
        sourceRevisionId: 'SOP-001-R1',
        sourceId: 'SOP-001',
        sourceType: 'sop',
        revision: 1
      })
    ).toThrow();

    // Traversal path
    expect(() =>
      EvaluationSourceDtoSchema.parse({
        ...valid,
        path: '../outside.md'
      })
    ).toThrow();

    expect(() =>
      EvaluationSourceDtoSchema.parse({
        ...valid,
        path: 'nested/../../outside.md'
      })
    ).toThrow();

    // Absolute path
    expect(() =>
      EvaluationSourceDtoSchema.parse({
        ...valid,
        path: '/etc/passwd'
      })
    ).toThrow();

    // Invalid revision (0 or negative)
    expect(() =>
      EvaluationSourceDtoSchema.parse({
        ...valid,
        revision: 0
      })
    ).toThrow();

    // Invalid sourceType
    expect(() =>
      EvaluationSourceDtoSchema.parse({
        ...valid,
        sourceType: 'blog-post'
      })
    ).toThrow();
  });

  it('SafeRelativePathSchema validates safe relative paths and rejects traversals or absolute paths', () => {
    expect(SafeRelativePathSchema.parse('source.md')).toBe('source.md');
    expect(SafeRelativePathSchema.parse('fixtures/package/source.1.md')).toBe(
      'fixtures/package/source.1.md'
    );

    expect(() => SafeRelativePathSchema.parse('../escape.md')).toThrow();
    expect(() => SafeRelativePathSchema.parse('foo/../bar')).toThrow();
    expect(() => SafeRelativePathSchema.parse('/root/file.md')).toThrow();
    expect(() => SafeRelativePathSchema.parse('\\windows\\root')).toThrow();
    expect(() => SafeRelativePathSchema.parse('C:/windows/file')).toThrow();
  });

  it('ExpectedFindingDtoSchema requires category and rejects payloads without it', () => {
    const valid = {
      findingKey: 'FINDING-1',
      category: 'contradictory-approval-thresholds',
      type: 'contradiction',
      evidence: [{ sourceRevisionId: 'SOP-001-R1', locator: 'thresholds#1' }],
      relatedRequirementKeys: ['REQ-1'],
      rationale: 'Threshold contradiction'
    };
    expect(ExpectedFindingDtoSchema.parse(valid)).toEqual(valid);

    // Missing category
    expect(() =>
      ExpectedFindingDtoSchema.parse({
        findingKey: 'FINDING-1',
        type: 'contradiction',
        evidence: [{ sourceRevisionId: 'SOP-001-R1', locator: 'thresholds#1' }],
        relatedRequirementKeys: ['REQ-1']
      })
    ).toThrow();

    // Invalid category
    expect(() =>
      ExpectedFindingDtoSchema.parse({
        ...valid,
        category: 'unrecognized-category'
      })
    ).toThrow();
  });

  it('ExpectedNonFindingDtoSchema requires category and evidence and rejects payloads missing them', () => {
    const valid = {
      description: 'Scoped per-diem rules do not contradict',
      category: 'false-positive-near-conflict',
      wouldBeType: 'contradiction',
      evidence: [{ sourceRevisionId: 'EXP-001-R1', locator: 'rates#1' }]
    };
    expect(ExpectedNonFindingDtoSchema.parse(valid)).toEqual(valid);

    // Missing category
    expect(() =>
      ExpectedNonFindingDtoSchema.parse({
        description: 'Scoped per-diem rules do not contradict',
        wouldBeType: 'contradiction',
        evidence: [{ sourceRevisionId: 'EXP-001-R1', locator: 'rates#1' }]
      })
    ).toThrow();

    // Missing evidence
    expect(() =>
      ExpectedNonFindingDtoSchema.parse({
        description: 'Scoped per-diem rules do not contradict',
        category: 'false-positive-near-conflict',
        wouldBeType: 'contradiction',
        evidence: []
      })
    ).toThrow();
  });

  it('ExpectedRequirementDtoSchema validates valid requirement and rejects empty evidence', () => {
    const valid = {
      requirementKey: 'REQ-1',
      category: 'business-rule',
      origin: 'EXPLICIT',
      evidence: [{ sourceRevisionId: 'SOP-001-R1', locator: 'rule#1' }],
      statementPattern: 'must approve.*'
    };
    expect(ExpectedRequirementDtoSchema.parse(valid)).toEqual(valid);

    expect(() =>
      ExpectedRequirementDtoSchema.parse({
        ...valid,
        evidence: []
      })
    ).toThrow();
  });

  it('EvaluationFixtureDtoSchema validates full fixture structure', () => {
    const fixture = {
      fixtureId: 'approval-threshold-contradiction-basic',
      version: '1.0.0',
      title: 'Basic Approval Contradiction',
      description: 'Tests detection of conflicting approval limits.',
      categories: ['contradictory-approval-thresholds'],
      canonicalMessyPackage: false,
      sources: [
        {
          sourceRevisionId: 'SOP-001-R1',
          sourceId: 'SOP-001',
          sourceType: 'sop',
          revision: 1,
          path: 'source.md'
        }
      ],
      expectedRequirements: [
        {
          requirementKey: 'REQ-1',
          category: 'business-rule',
          origin: 'EXPLICIT',
          evidence: [{ sourceRevisionId: 'SOP-001-R1', locator: 'section-1#1' }]
        }
      ],
      expectedFindings: [
        {
          findingKey: 'FINDING-1',
          category: 'contradictory-approval-thresholds',
          type: 'contradiction',
          evidence: [{ sourceRevisionId: 'SOP-001-R1', locator: 'section-1#1' }],
          relatedRequirementKeys: ['REQ-1'],
          rationale: 'Contradictory approval thresholds'
        }
      ],
      expectedNonFindings: []
    };

    expect(EvaluationFixtureDtoSchema.parse(fixture)).toEqual(fixture);

    // Empty categories is rejected
    expect(() =>
      EvaluationFixtureDtoSchema.parse({
        ...fixture,
        categories: []
      })
    ).toThrow();

    // Empty sources is rejected
    expect(() =>
      EvaluationFixtureDtoSchema.parse({
        ...fixture,
        sources: []
      })
    ).toThrow();
  });

  it('EvaluationManifestDtoSchema validates manifest structure and enforces v<major>.<minor> corpusVersion', () => {
    const manifest = {
      corpusVersion: 'v1.0',
      generatedAt: '2026-09-16T12:00:00.000Z',
      fixtures: [
        {
          fixtureId: 'approval-threshold-contradiction-basic',
          path: 'fixtures/approval-threshold-contradiction-basic',
          categories: ['contradictory-approval-thresholds'],
          canonicalMessyPackage: false
        }
      ]
    };

    expect(EvaluationManifestDtoSchema.parse(manifest)).toEqual(manifest);

    // Valid version formats
    expect(CORPUS_VERSION_REGEX.test('v1.0')).toBe(true);
    expect(CORPUS_VERSION_REGEX.test('v2.12')).toBe(true);
    expect(CORPUS_VERSION_REGEX.test('v1')).toBe(false);
    expect(
      EvaluationManifestDtoSchema.parse({ ...manifest, corpusVersion: 'v1.0' }).corpusVersion
    ).toBe('v1.0');
    expect(
      EvaluationManifestDtoSchema.parse({ ...manifest, corpusVersion: 'v2.12' }).corpusVersion
    ).toBe('v2.12');

    // Invalid version formats
    const invalidVersions = ['v1', '1.0', 'v1.0.0', 'release-1.0', 'v1.0-alpha', '', 'v1.', '.0'];
    for (const invalid of invalidVersions) {
      expect(
        () => EvaluationManifestDtoSchema.parse({ ...manifest, corpusVersion: invalid }),
        `Expected corpusVersion '${invalid}' to be rejected`
      ).toThrow();
    }

    // Invalid ISO instant
    expect(() =>
      EvaluationManifestDtoSchema.parse({
        ...manifest,
        generatedAt: 'not-a-date'
      })
    ).toThrow();

    // Traversal or absolute fixture path in manifest entry
    expect(() =>
      EvaluationManifestDtoSchema.parse({
        ...manifest,
        fixtures: [
          {
            fixtureId: 'outside',
            path: '../outside-dir',
            categories: ['contradictory-approval-thresholds'],
            canonicalMessyPackage: false
          }
        ]
      })
    ).toThrow();

    expect(() =>
      EvaluationManifestDtoSchema.parse({
        ...manifest,
        fixtures: [
          {
            fixtureId: 'outside',
            path: '/etc/fixtures',
            categories: ['contradictory-approval-thresholds'],
            canonicalMessyPackage: false
          }
        ]
      })
    ).toThrow();
  });

  describe('Phase 1.6 Evaluation Report and Runner Schemas', () => {
    it('SourceLineageMapEntrySchema validates valid entry and rejects invalid', () => {
      const validEntry = {
        declaredRevisionId: 'MESSY-SOP-001-R2',
        declaredSourceId: 'CORE-SOP-001',
        declaredOrdinal: 2,
        declaredPredecessorAlias: 'MESSY-SOP-001-R1',
        capturedRevisionId: 'CORE-SOP-001-R2',
        capturedSourceId: 'CORE-SOP-001',
        capturedOrdinal: 2,
        capturedPredecessorId: 'CORE-SOP-001-R1',
        contentHash: 'abcdef1234567890abcdef1234567890'
      };
      expect(SourceLineageMapEntrySchema.parse(validEntry)).toEqual(validEntry);

      // Rejects negative ordinal
      expect(() =>
        SourceLineageMapEntrySchema.parse({ ...validEntry, declaredOrdinal: -1 })
      ).toThrow();
      expect(() =>
        SourceLineageMapEntrySchema.parse({ ...validEntry, capturedOrdinal: 0 })
      ).toThrow();
      // Rejects empty declaredRevisionId
      expect(() =>
        SourceLineageMapEntrySchema.parse({ ...validEntry, declaredRevisionId: '' })
      ).toThrow();
    });

    it('ScoreCountersSchema handles null and valid numbers correctly', () => {
      const zeroDenominator = {
        truePositives: 0,
        falsePositives: 0,
        falseNegatives: 0,
        precision: null,
        recall: null,
        f1Score: null
      };
      expect(ScoreCountersSchema.parse(zeroDenominator)).toEqual(zeroDenominator);

      const withScores = {
        truePositives: 4,
        falsePositives: 1,
        falseNegatives: 1,
        precision: 0.8,
        recall: 0.8,
        f1Score: 0.8
      };
      expect(ScoreCountersSchema.parse(withScores)).toEqual(withScores);

      // Rejects negative counts
      expect(() => ScoreCountersSchema.parse({ ...withScores, truePositives: -1 })).toThrow();
      // Rejects precision > 1
      expect(() => ScoreCountersSchema.parse({ ...withScores, precision: 1.5 })).toThrow();
    });

    it('EvaluationFixtureResultSchema discriminates completed vs failed results', () => {
      const completed = {
        fixtureId: 'test-fixture',
        status: 'completed' as const,
        sourceLineageMap: [
          {
            declaredRevisionId: 'DEC-R1',
            declaredSourceId: 'SRC-01',
            declaredOrdinal: 1,
            capturedRevisionId: 'SRC-01-R1',
            capturedSourceId: 'SRC-01',
            capturedOrdinal: 1,
            contentHash: 'hash1'
          }
        ],
        executed: {
          capturedSourceRevisionIds: ['SRC-01-R1'],
          inputSourceRevisionIds: ['SRC-01-R1'],
          acceptedRequirementRevisions: ['REQ-01-R1'],
          acceptedFindingIds: ['FIND-01'],
          acceptedRequirementCount: 1,
          rejectedRequirementCount: 0,
          acceptedFindingCount: 1,
          rejectedFindingCount: 0,
          providerMetadata: {
            status: 'available' as const,
            value: {
              provider: 'fixture-replay',
              model: 'replay-v1',
              durationMs: 12
            }
          }
        },
        measured: {
          durationMs: 45,
          score: {
            requirementsByCategory: {
              'business-rule': {
                truePositives: 1,
                falsePositives: 0,
                falseNegatives: 0,
                precision: 1.0,
                recall: 1.0,
                f1Score: 1.0
              }
            },
            findingsByCategory: {
              'contradictory-approval-thresholds': {
                truePositives: 1,
                falsePositives: 0,
                falseNegatives: 0,
                precision: 1.0,
                recall: 1.0,
                f1Score: 1.0
              }
            },
            unclassifiedFindingsCount: 0,
            matchedRequirements: [
              {
                expectedRequirementKey: 'REQ-1',
                observedRequirementRevisionId: 'REQ-01-R1',
                category: 'business-rule',
                origin: 'EXPLICIT',
                declaredEvidence: [{ sourceRevisionId: 'DEC-R1', locator: 'loc-1' }],
                normalizedEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'loc-1' }],
                observedEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'loc-1' }],
                statement: 'statement'
              }
            ],
            mismatchedRequirements: [],
            matchedFindings: [
              {
                expectedFindingKey: 'FIND-1',
                observedFindingId: 'FIND-01',
                category: 'contradictory-approval-thresholds',
                type: 'contradiction',
                declaredEvidence: [{ sourceRevisionId: 'DEC-R1', locator: 'loc-1' }],
                normalizedEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'loc-1' }],
                observedEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'loc-1' }],
                relatedRequirementKeys: ['REQ-1']
              }
            ],
            mismatchedFindings: [],
            unclassifiedFindings: [],
            rejectedCompilerRequirements: [],
            rejectedCompilerFindings: []
          }
        }
      };

      const parsedCompleted = EvaluationFixtureResultSchema.parse(completed);
      expect(parsedCompleted.status).toBe('completed');

      const failed = {
        fixtureId: 'failed-fixture',
        status: 'failed' as const,
        error: {
          name: 'CompileRequirementsError',
          message: 'Malformed output',
          phase: 'compile' as const
        }
      };

      const parsedFailed = EvaluationFixtureResultSchema.parse(failed);
      expect(parsedFailed.status).toBe('failed');
    });

    it('EvaluationRunRecordSchema round-trips a valid report envelope', () => {
      const report = {
        reportSchemaVersion: '1.0.0' as const,
        runId: 'RUN-001',
        executedAt: '2026-09-17T02:00:00.000Z',
        corpusVersion: 'v1.0',
        corpusIdentity: 'sha256-corpus-identity',
        candidateSha: { status: 'available' as const, value: 'abcd1234efgh5678' },
        fixtureOrder: ['fixture-1'],
        fixtureResults: [
          {
            fixtureId: 'fixture-1',
            status: 'failed' as const,
            error: {
              name: 'Error',
              message: 'Test failure',
              phase: 'capture' as const
            }
          }
        ],
        aggregateScores: {
          totalFixtures: 1,
          completedFixtures: 0,
          failedFixtures: 1,
          requirementsByCategory: {},
          findingsByCategory: {},
          unclassifiedFindingsCount: 0
        },
        reportArtifacts: {
          jsonReportPath: { status: 'available' as const, value: 'reports/report.json' },
          jsonReportDigest: { status: 'available' as const, value: 'digest-123' },
          markdownReportPath: { status: 'unavailable' as const, reason: 'Not generated' },
          markdownReportDigest: { status: 'unavailable' as const, reason: 'Not generated' }
        },
        provenance: {
          requested: {
            candidateSha: { status: 'available' as const, value: 'abcd1234efgh5678' },
            providerMode: 'fixture-replay',
            providerName: 'fixture-replay',
            manifestPath: 'manifests/corpus.v1.json',
            outputReportPath: { status: 'available' as const, value: 'reports/report.json' },
            storeDir: { status: 'unavailable' as const, reason: 'In-memory' }
          },
          declared: {
            manifestVersion: 'v1.0',
            manifestHash: 'hash-manifest',
            canonicalizationVersion: 'v1',
            corpusIdentity: 'sha256-corpus-identity',
            fixtureOrder: ['fixture-1'],
            fixtures: [
              {
                fixtureId: 'fixture-1',
                expectedJsonHash: 'hash-expected',
                sources: [
                  {
                    sourceRevisionId: 'SRC-R1',
                    sourceId: 'SRC-01',
                    sourceType: 'sop' as const,
                    revision: 1,
                    contentHash: 'hash-src'
                  }
                ]
              }
            ]
          },
          configured: {
            compilerVersion: '1.0.0',
            promptVersion: '1.0.0',
            gatewayConfig: { provider: 'fixture-replay' },
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch
          },
          verified: {
            schemaValidation: true,
            corpusLineageValid: true,
            persistenceVerified: true,
            reportDigest: 'digest-report'
          }
        }
      };

      const runRecord = {
        id: 'RUN-001',
        corpusVersion: 'v1.0',
        executedAt: '2026-09-17T02:00:00.000Z',
        fixtureResults: report.fixtureResults,
        report
      };

      const parsed = EvaluationRunRecordSchema.parse(runRecord);
      expect(parsed).toEqual(runRecord);
    });

    it('SafeFixtureIdSchema rejects traversal and non-alphanumeric identifiers', () => {
      expect(() => SafeFixtureIdSchema.parse('../../../escaped')).toThrow();
      expect(() => SafeFixtureIdSchema.parse('foo/bar')).toThrow();
      expect(() => SafeFixtureIdSchema.parse('foo\\bar')).toThrow();
      expect(() => SafeFixtureIdSchema.parse('foo bar')).toThrow();
      expect(() => SafeFixtureIdSchema.parse('')).toThrow();
      expect(SafeFixtureIdSchema.parse('valid-fixture_01')).toBe('valid-fixture_01');
    });

    it('ScoreCountersSchema rejects mathematically inconsistent precision, recall, and f1Score', () => {
      // TP=0, FP=100, but precision=1 -> must throw
      expect(() =>
        ScoreCountersSchema.parse({
          truePositives: 0,
          falsePositives: 100,
          falseNegatives: 0,
          precision: 1,
          recall: null,
          f1Score: 1
        })
      ).toThrow(/precision mismatch/);

      // TP+FP=0, but precision is not null
      expect(() =>
        ScoreCountersSchema.parse({
          truePositives: 0,
          falsePositives: 0,
          falseNegatives: 5,
          precision: 0,
          recall: 0,
          f1Score: 0
        })
      ).toThrow(/precision must be null/);

      // Consistent counters
      const valid = {
        truePositives: 2,
        falsePositives: 2,
        falseNegatives: 0,
        precision: 0.5,
        recall: 1,
        f1Score: (2 * 0.5 * 1) / (0.5 + 1)
      };
      expect(ScoreCountersSchema.parse(valid)).toEqual(valid);
    });

    it('EvaluationReportSchema rejects duplicate fixtureOrder and count mismatches', () => {
      const validReport = {
        reportSchemaVersion: '1.0.0' as const,
        runId: 'RUN-001',
        executedAt: '2026-09-17T02:00:00.000Z',
        corpusVersion: 'v1.0',
        corpusIdentity: 'sha256-corpus-identity',
        candidateSha: { status: 'available' as const, value: 'abcd1234efgh5678' },
        fixtureOrder: ['fixture-1'],
        fixtureResults: [
          {
            fixtureId: 'fixture-1',
            status: 'failed' as const,
            error: {
              name: 'Error',
              message: 'Test failure',
              phase: 'capture' as const
            }
          }
        ],
        aggregateScores: {
          totalFixtures: 1,
          completedFixtures: 0,
          failedFixtures: 1,
          requirementsByCategory: {},
          findingsByCategory: {},
          unclassifiedFindingsCount: 0
        },
        reportArtifacts: {
          jsonReportPath: { status: 'available' as const, value: 'reports/report.json' },
          jsonReportDigest: { status: 'available' as const, value: 'digest-123' },
          markdownReportPath: { status: 'unavailable' as const, reason: 'Not generated' },
          markdownReportDigest: { status: 'unavailable' as const, reason: 'Not generated' }
        },
        provenance: {
          requested: {
            candidateSha: { status: 'available' as const, value: 'abcd1234efgh5678' },
            providerMode: 'fixture-replay',
            providerName: 'fixture-replay',
            manifestPath: 'manifests/corpus.v1.json',
            outputReportPath: { status: 'available' as const, value: 'reports/report.json' },
            storeDir: { status: 'unavailable' as const, reason: 'In-memory' }
          },
          declared: {
            manifestVersion: 'v1.0',
            manifestHash: 'hash-manifest',
            canonicalizationVersion: 'v1',
            corpusIdentity: 'sha256-corpus-identity',
            fixtureOrder: ['fixture-1'],
            fixtures: [
              {
                fixtureId: 'fixture-1',
                expectedJsonHash: 'hash-expected',
                sources: [
                  {
                    sourceRevisionId: 'SRC-R1',
                    sourceId: 'SRC-01',
                    sourceType: 'sop' as const,
                    revision: 1,
                    contentHash: 'hash-src'
                  }
                ]
              }
            ]
          },
          configured: {
            compilerVersion: '1.0.0',
            promptVersion: '1.0.0',
            gatewayConfig: { provider: 'fixture-replay' },
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch
          },
          verified: {
            schemaValidation: true,
            corpusLineageValid: true,
            persistenceVerified: true,
            reportDigest: 'digest-report'
          }
        }
      };

      // Inconsistent totalFixtures
      expect(() =>
        EvaluationReportSchema.parse({
          ...validReport,
          aggregateScores: { ...validReport.aggregateScores, totalFixtures: 999 }
        })
      ).toThrow(/aggregateScores\.totalFixtures \(999\) does not match fixture count/);

      // Inconsistent declared corpus identity
      expect(() =>
        EvaluationReportSchema.parse({
          ...validReport,
          provenance: {
            ...validReport.provenance,
            declared: {
              ...validReport.provenance.declared,
              corpusIdentity: 'different-identity'
            }
          }
        })
      ).toThrow(/does not match declared corpusIdentity/);
    });

    it('EvaluationRunRecordSchema rejects envelope ID mismatch with report.runId', () => {
      const validReport = {
        reportSchemaVersion: '1.0.0' as const,
        runId: 'RUN-001',
        executedAt: '2026-09-17T02:00:00.000Z',
        corpusVersion: 'v1.0',
        corpusIdentity: 'sha256-corpus-identity',
        candidateSha: { status: 'available' as const, value: 'abcd1234efgh5678' },
        fixtureOrder: ['fixture-1'],
        fixtureResults: [
          {
            fixtureId: 'fixture-1',
            status: 'failed' as const,
            error: {
              name: 'Error',
              message: 'Test failure',
              phase: 'capture' as const
            }
          }
        ],
        aggregateScores: {
          totalFixtures: 1,
          completedFixtures: 0,
          failedFixtures: 1,
          requirementsByCategory: {},
          findingsByCategory: {},
          unclassifiedFindingsCount: 0
        },
        reportArtifacts: {
          jsonReportPath: { status: 'available' as const, value: 'reports/report.json' },
          jsonReportDigest: { status: 'available' as const, value: 'digest-123' },
          markdownReportPath: { status: 'unavailable' as const, reason: 'Not generated' },
          markdownReportDigest: { status: 'unavailable' as const, reason: 'Not generated' }
        },
        provenance: {
          requested: {
            candidateSha: { status: 'available' as const, value: 'abcd1234efgh5678' },
            providerMode: 'fixture-replay',
            providerName: 'fixture-replay',
            manifestPath: 'manifests/corpus.v1.json',
            outputReportPath: { status: 'available' as const, value: 'reports/report.json' },
            storeDir: { status: 'unavailable' as const, reason: 'In-memory' }
          },
          declared: {
            manifestVersion: 'v1.0',
            manifestHash: 'hash-manifest',
            canonicalizationVersion: 'v1',
            corpusIdentity: 'sha256-corpus-identity',
            fixtureOrder: ['fixture-1'],
            fixtures: [
              {
                fixtureId: 'fixture-1',
                expectedJsonHash: 'hash-expected',
                sources: [
                  {
                    sourceRevisionId: 'SRC-R1',
                    sourceId: 'SRC-01',
                    sourceType: 'sop' as const,
                    revision: 1,
                    contentHash: 'hash-src'
                  }
                ]
              }
            ]
          },
          configured: {
            compilerVersion: '1.0.0',
            promptVersion: '1.0.0',
            gatewayConfig: { provider: 'fixture-replay' },
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch
          },
          verified: {
            schemaValidation: true,
            corpusLineageValid: true,
            persistenceVerified: true,
            reportDigest: 'digest-report'
          }
        }
      };

      expect(() =>
        EvaluationRunRecordSchema.parse({
          id: 'RUN-DIFFERENT',
          corpusVersion: 'v1.0',
          executedAt: '2026-09-17T02:00:00.000Z',
          fixtureResults: validReport.fixtureResults,
          report: validReport
        })
      ).toThrow(/does not match report\.runId/);
    });

    it('canonicalizeReportForDigest produces deterministic non-circular projection', () => {
      const validReport = {
        reportSchemaVersion: '1.0.0' as const,
        runId: 'RUN-001',
        executedAt: '2026-09-17T02:00:00.000Z',
        corpusVersion: 'v1.0',
        corpusIdentity: 'sha256-corpus-identity',
        candidateSha: { status: 'available' as const, value: 'abcd1234efgh5678' },
        fixtureOrder: ['fixture-1'],
        fixtureResults: [
          {
            fixtureId: 'fixture-1',
            status: 'failed' as const,
            error: {
              name: 'Error',
              message: 'Test failure',
              phase: 'capture' as const
            }
          }
        ],
        aggregateScores: {
          totalFixtures: 1,
          completedFixtures: 0,
          failedFixtures: 1,
          requirementsByCategory: {},
          findingsByCategory: {},
          unclassifiedFindingsCount: 0
        },
        reportArtifacts: {
          jsonReportPath: { status: 'available' as const, value: 'reports/report.json' },
          jsonReportDigest: { status: 'available' as const, value: 'digest-foo' },
          markdownReportPath: { status: 'unavailable' as const, reason: 'Not generated' },
          markdownReportDigest: { status: 'unavailable' as const, reason: 'Not generated' }
        },
        provenance: {
          requested: {
            candidateSha: { status: 'available' as const, value: 'abcd1234efgh5678' },
            providerMode: 'fixture-replay',
            providerName: 'fixture-replay',
            manifestPath: 'manifests/corpus.v1.json',
            outputReportPath: { status: 'available' as const, value: 'reports/report.json' },
            storeDir: { status: 'unavailable' as const, reason: 'In-memory' }
          },
          declared: {
            manifestVersion: 'v1.0',
            manifestHash: 'hash-manifest',
            canonicalizationVersion: 'v1',
            corpusIdentity: 'sha256-corpus-identity',
            fixtureOrder: ['fixture-1'],
            fixtures: [
              {
                fixtureId: 'fixture-1',
                expectedJsonHash: 'hash-expected',
                sources: [
                  {
                    sourceRevisionId: 'SRC-R1',
                    sourceId: 'SRC-01',
                    sourceType: 'sop' as const,
                    revision: 1,
                    contentHash: 'hash-src'
                  }
                ]
              }
            ]
          },
          configured: {
            compilerVersion: '1.0.0',
            promptVersion: '1.0.0',
            gatewayConfig: { provider: 'fixture-replay' },
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch
          },
          verified: {
            schemaValidation: true,
            corpusLineageValid: true,
            persistenceVerified: true,
            reportDigest: 'digest-report-initial'
          }
        }
      };

      const c1 = canonicalizeReportForDigest(validReport);
      // Mutate verified.reportDigest and jsonReportDigest
      const modifiedReport = {
        ...validReport,
        reportArtifacts: {
          ...validReport.reportArtifacts,
          jsonReportDigest: { status: 'available' as const, value: 'digest-bar' }
        },
        provenance: {
          ...validReport.provenance,
          verified: {
            ...validReport.provenance.verified,
            reportDigest: 'digest-report-changed'
          }
        }
      };
      const c2 = canonicalizeReportForDigest(modifiedReport);
      expect(c1).toBe(c2);
    });

    it('canonicalizeReportForDigest produces identical canonical string regardless of key ordering', () => {
      const obj1 = {
        reportSchemaVersion: '1.0.0' as const,
        runId: 'RUN-KEY-ORDER',
        executedAt: '2026-09-17T02:00:00.000Z',
        corpusVersion: 'v1.0',
        corpusIdentity: 'identity-123',
        candidateSha: { status: 'unavailable' as const, reason: 'N/A' },
        fixtureOrder: ['f1'],
        fixtureResults: [],
        aggregateScores: {
          totalFixtures: 0,
          completedFixtures: 0,
          failedFixtures: 0,
          requirementsByCategory: {},
          findingsByCategory: {},
          unclassifiedFindingsCount: 0
        },
        reportArtifacts: {
          jsonReportPath: { status: 'unavailable' as const, reason: 'N/A' },
          jsonReportDigest: { status: 'unavailable' as const, reason: 'N/A' },
          markdownReportPath: { status: 'unavailable' as const, reason: 'N/A' },
          markdownReportDigest: { status: 'unavailable' as const, reason: 'N/A' }
        },
        provenance: {
          requested: {
            candidateSha: { status: 'unavailable' as const, reason: 'N/A' },
            providerMode: 'fixture-replay',
            providerName: 'fixture-replay',
            manifestPath: 'm.json',
            outputReportPath: { status: 'unavailable' as const, reason: 'N/A' },
            storeDir: { status: 'unavailable' as const, reason: 'N/A' }
          },
          declared: {
            manifestVersion: 'v1.0',
            manifestHash: 'mh',
            canonicalizationVersion: 'v1',
            corpusIdentity: 'identity-123',
            fixtureOrder: ['f1'],
            fixtures: []
          },
          configured: {
            compilerVersion: '1.0.0',
            promptVersion: '1.0.0',
            gatewayConfig: {},
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch
          },
          verified: {
            schemaValidation: true,
            corpusLineageValid: true,
            persistenceVerified: true,
            reportDigest: 'digest-1'
          }
        }
      };

      // Create obj2 with reversed key orders at multiple levels
      const obj2 = {
        provenance: {
          verified: {
            reportDigest: 'different-digest',
            persistenceVerified: true,
            corpusLineageValid: true,
            schemaValidation: true
          },
          configured: {
            arch: process.arch,
            platform: process.platform,
            nodeVersion: process.version,
            gatewayConfig: {},
            promptVersion: '1.0.0',
            compilerVersion: '1.0.0'
          },
          declared: {
            fixtures: [],
            fixtureOrder: ['f1'],
            corpusIdentity: 'identity-123',
            canonicalizationVersion: 'v1',
            manifestHash: 'mh',
            manifestVersion: 'v1.0'
          },
          requested: {
            storeDir: { reason: 'N/A', status: 'unavailable' as const },
            outputReportPath: { reason: 'N/A', status: 'unavailable' as const },
            manifestPath: 'm.json',
            providerName: 'fixture-replay',
            providerMode: 'fixture-replay',
            candidateSha: { reason: 'N/A', status: 'unavailable' as const }
          }
        },
        reportArtifacts: {
          markdownReportDigest: { reason: 'N/A', status: 'unavailable' as const },
          markdownReportPath: { reason: 'N/A', status: 'unavailable' as const },
          jsonReportDigest: { reason: 'N/A', status: 'unavailable' as const },
          jsonReportPath: { reason: 'N/A', status: 'unavailable' as const }
        },
        aggregateScores: {
          unclassifiedFindingsCount: 0,
          findingsByCategory: {},
          requirementsByCategory: {},
          failedFixtures: 0,
          completedFixtures: 0,
          totalFixtures: 0
        },
        fixtureResults: [],
        fixtureOrder: ['f1'],
        candidateSha: { reason: 'N/A', status: 'unavailable' as const },
        corpusIdentity: 'identity-123',
        corpusVersion: 'v1.0',
        executedAt: '2026-09-17T02:00:00.000Z',
        runId: 'RUN-KEY-ORDER',
        reportSchemaVersion: '1.0.0' as const
      };

      expect(canonicalizeReportForDigest(obj1)).toBe(canonicalizeReportForDigest(obj2));
    });
  });
});
