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
  SafeRelativePathSchema
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
});
