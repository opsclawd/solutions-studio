import { describe, it, expect } from 'vitest';
import { scoreFixture } from '../../src/application/evaluation/scoreFixture.js';
import type { NormalizedGroundTruth } from '../../src/application/evaluation/normalizeExpectedGroundTruth.js';
import {
  createRequirementId,
  createRequirementRevisionId,
  createFindingId,
  createSourceRevisionId,
  createEvidenceLocator,
  createEvidenceReference,
  createRequirementRevision,
  createCandidateFinding
} from '@solutions-studio/domain';

describe('scoreFixture (pure structural scoring)', () => {
  const baseEvidenceRef = createEvidenceReference(
    createSourceRevisionId('SRC-01-R1'),
    createEvidenceLocator('sec-1#1.1')
  );

  it('paraphrase statement text remains a requirement True Positive', () => {
    const groundTruth: NormalizedGroundTruth = {
      expectedRequirements: [
        {
          requirementKey: 'REQ-01',
          category: 'business-rule',
          origin: 'EXPLICIT',
          evidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }],
          declaredEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }],
          normalizedEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }]
        }
      ],
      expectedFindings: [],
      expectedNonFindings: []
    };

    const observedRequirement = createRequirementRevision({
      id: createRequirementRevisionId('REQ-OBS-01-R1'),
      requirementId: createRequirementId('REQ-OBS-01'),
      revision: 1,
      statement: 'Totally paraphrased statement that conveys the same business meaning',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'PENDING',
      resolutionState: 'UNRESOLVED',
      evidence: [baseEvidenceRef]
    });

    const score = scoreFixture({
      groundTruth,
      observedRequirements: [observedRequirement],
      observedFindings: []
    });

    expect(score.matchedRequirements).toHaveLength(1);
    expect(score.mismatchedRequirements).toHaveLength(0);
    const catScore = score.requirementsByCategory['business-rule']!;
    expect(catScore.truePositives).toBe(1);
    expect(catScore.falsePositives).toBe(0);
    expect(catScore.falseNegatives).toBe(0);
    expect(catScore.precision).toBe(1);
    expect(catScore.recall).toBe(1);
    expect(catScore.f1Score).toBe(1);
  });

  it('mismatched category or origin produces a False Negative and a False Positive', () => {
    const groundTruth: NormalizedGroundTruth = {
      expectedRequirements: [
        {
          requirementKey: 'REQ-01',
          category: 'business-rule',
          origin: 'EXPLICIT',
          evidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }],
          declaredEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }],
          normalizedEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }]
        }
      ],
      expectedFindings: [],
      expectedNonFindings: []
    };

    // Observed has wrong origin: INFERRED instead of EXPLICIT
    const observedRequirement = createRequirementRevision({
      id: createRequirementRevisionId('REQ-OBS-01-R1'),
      requirementId: createRequirementId('REQ-OBS-01'),
      revision: 1,
      statement: 'Some statement',
      category: 'business-rule',
      origin: 'INFERRED',
      reviewState: 'PENDING',
      resolutionState: 'UNRESOLVED',
      evidence: [baseEvidenceRef]
    });

    const score = scoreFixture({
      groundTruth,
      observedRequirements: [observedRequirement],
      observedFindings: []
    });

    expect(score.matchedRequirements).toHaveLength(0);
    expect(score.mismatchedRequirements).toHaveLength(2); // 1 missing expected, 1 unmatched observed

    const catScore = score.requirementsByCategory['business-rule']!;
    expect(catScore.truePositives).toBe(0);
    expect(catScore.falsePositives).toBe(1);
    expect(catScore.falseNegatives).toBe(1);
    expect(catScore.precision).toBe(0);
    expect(catScore.recall).toBe(0);
  });

  it('duplicate observed requirements produce an additional False Positive', () => {
    const groundTruth: NormalizedGroundTruth = {
      expectedRequirements: [
        {
          requirementKey: 'REQ-01',
          category: 'business-rule',
          origin: 'EXPLICIT',
          evidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }],
          declaredEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }],
          normalizedEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }]
        }
      ],
      expectedFindings: [],
      expectedNonFindings: []
    };

    const req1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-OBS-01-R1'),
      requirementId: createRequirementId('REQ-OBS-01'),
      revision: 1,
      statement: 'First candidate',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'PENDING',
      resolutionState: 'UNRESOLVED',
      evidence: [baseEvidenceRef]
    });

    const req2 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-OBS-02-R1'),
      requirementId: createRequirementId('REQ-OBS-02'),
      revision: 1,
      statement: 'Duplicate candidate with identical evidence',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'PENDING',
      resolutionState: 'UNRESOLVED',
      evidence: [baseEvidenceRef]
    });

    const score = scoreFixture({
      groundTruth,
      observedRequirements: [req1, req2],
      observedFindings: []
    });

    expect(score.matchedRequirements).toHaveLength(1);
    expect(score.mismatchedRequirements).toHaveLength(1);
    const catScore = score.requirementsByCategory['business-rule']!;
    expect(catScore.truePositives).toBe(1);
    expect(catScore.falsePositives).toBe(1);
    expect(catScore.falseNegatives).toBe(0);
    expect(catScore.precision).toBe(0.5);
    expect(catScore.recall).toBe(1.0);
  });

  it('same-type findings with different related requirement targets cannot match', () => {
    const groundTruth: NormalizedGroundTruth = {
      expectedRequirements: [
        {
          requirementKey: 'REQ-01',
          category: 'business-rule',
          origin: 'EXPLICIT',
          evidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }],
          declaredEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }],
          normalizedEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }]
        },
        {
          requirementKey: 'REQ-02',
          category: 'business-rule',
          origin: 'EXPLICIT',
          evidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.2' }],
          declaredEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.2' }],
          normalizedEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.2' }]
        }
      ],
      expectedFindings: [
        {
          findingKey: 'FIND-01',
          category: 'contradictory-approval-thresholds',
          type: 'contradiction',
          evidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }],
          declaredEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }],
          normalizedEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }],
          relatedRequirementKeys: ['REQ-01']
        }
      ],
      expectedNonFindings: []
    };

    const req1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-OBS-01-R1'),
      requirementId: createRequirementId('REQ-OBS-01'),
      revision: 1,
      statement: 'Req 1',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'PENDING',
      resolutionState: 'UNRESOLVED',
      evidence: [baseEvidenceRef]
    });

    const req2 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-OBS-02-R1'),
      requirementId: createRequirementId('REQ-OBS-02'),
      revision: 1,
      statement: 'Req 2',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'PENDING',
      resolutionState: 'UNRESOLVED',
      evidence: [
        createEvidenceReference(
          createSourceRevisionId('SRC-01-R1'),
          createEvidenceLocator('sec-1#1.2')
        )
      ]
    });

    // Observed finding points to REQ-02 instead of REQ-01
    const obsFinding = createCandidateFinding({
      id: createFindingId('FIND-OBS-01'),
      type: 'contradiction',
      affectedRequirementRevisions: [req2.id],
      evidence: [baseEvidenceRef],
      discoveredBy: 'model',
      disposition: 'OPEN'
    });

    const score = scoreFixture({
      groundTruth,
      observedRequirements: [req1, req2],
      observedFindings: [obsFinding]
    });

    expect(score.matchedFindings).toHaveLength(0);
    expect(score.mismatchedFindings).toHaveLength(2); // 1 missing expected finding, 1 unclassified observed
    const catScore = score.findingsByCategory['contradictory-approval-thresholds']!;
    expect(catScore.truePositives).toBe(0);
    expect(catScore.falsePositives).toBe(1);
    expect(catScore.falseNegatives).toBe(1);
    expect(catScore.precision).toBe(0);
  });

  it('an expected non-finding matched by an observed finding attributes a False Positive to non-finding category', () => {
    const groundTruth: NormalizedGroundTruth = {
      expectedRequirements: [],
      expectedFindings: [],
      expectedNonFindings: [
        {
          description: 'Permitted threshold difference between roles',
          category: 'false-positive-near-conflict',
          wouldBeType: 'contradiction',
          evidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }],
          declaredEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }],
          normalizedEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }]
        }
      ]
    };

    // Erroneously emitted contradiction finding matching the non-finding signature
    const spuriousFinding = createCandidateFinding({
      id: createFindingId('FIND-SPURIOUS-01'),
      type: 'contradiction',
      affectedRequirementRevisions: [],
      evidence: [baseEvidenceRef],
      discoveredBy: 'model',
      disposition: 'OPEN'
    });

    const score = scoreFixture({
      groundTruth,
      observedRequirements: [],
      observedFindings: [spuriousFinding]
    });

    expect(score.matchedFindings).toHaveLength(0);
    expect(score.unclassifiedFindingsCount).toBe(0); // Attributed to false-positive-near-conflict, not unclassified
    const nearConflictScore = score.findingsByCategory['false-positive-near-conflict']!;
    expect(nearConflictScore.falsePositives).toBe(1);
    expect(nearConflictScore.truePositives).toBe(0);
  });

  it('unclassified findings remain visible in unclassifiedFindings bucket and attribute category FP', () => {
    const groundTruth: NormalizedGroundTruth = {
      expectedRequirements: [],
      expectedFindings: [],
      expectedNonFindings: []
    };

    const strayFinding = createCandidateFinding({
      id: createFindingId('FIND-STRAY-01'),
      type: 'unsupported-assumption',
      affectedRequirementRevisions: [],
      evidence: [baseEvidenceRef],
      discoveredBy: 'model',
      disposition: 'OPEN'
    });

    const score = scoreFixture({
      groundTruth,
      observedRequirements: [],
      observedFindings: [strayFinding]
    });

    expect(score.unclassifiedFindingsCount).toBe(1);
    expect(score.unclassifiedFindings).toHaveLength(1);
    expect(score.unclassifiedFindings[0].findingId).toBe('FIND-STRAY-01');
    expect(score.unclassifiedFindings[0].type).toBe('unclassified-observed');
    expect(score.unclassifiedFindings[0].category).toBe('unsupported-assumptions');
    const catScore = score.findingsByCategory['unsupported-assumptions']!;
    expect(catScore.falsePositives).toBe(1);
    expect(catScore.precision).toBe(0);
  });

  it('a finding of a declared type with evidence that partially overlaps a non-finding fixture reduces category precision', () => {
    const ref1 = createEvidenceReference(
      createSourceRevisionId('SRC-01-R1'),
      createEvidenceLocator('sec-1#1.1')
    );
    const ref3 = createEvidenceReference(
      createSourceRevisionId('SRC-01-R1'),
      createEvidenceLocator('sec-1#1.3')
    );

    const groundTruth: NormalizedGroundTruth = {
      expectedRequirements: [],
      expectedFindings: [],
      expectedNonFindings: [
        {
          description: 'Near-conflict threshold pairing',
          category: 'false-positive-near-conflict',
          wouldBeType: 'contradiction',
          evidence: [
            { sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' },
            { sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.2' }
          ],
          declaredEvidence: [
            { sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' },
            { sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.2' }
          ],
          normalizedEvidence: [
            { sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' },
            { sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.2' }
          ]
        }
      ]
    };

    // Observed finding has partial evidence overlap (ref1 matches, ref3 differs)
    const partialOverlapFinding = createCandidateFinding({
      id: createFindingId('FIND-PARTIAL-01'),
      type: 'contradiction',
      affectedRequirementRevisions: [],
      evidence: [ref1, ref3],
      discoveredBy: 'model',
      disposition: 'OPEN'
    });

    const score = scoreFixture({
      groundTruth,
      observedRequirements: [],
      observedFindings: [partialOverlapFinding]
    });

    expect(score.matchedFindings).toHaveLength(0);
    // Unmatched with exact non-finding, but attributed to false-positive-near-conflict via overlap
    expect(score.unclassifiedFindingsCount).toBe(1);
    expect(score.unclassifiedFindings[0].category).toBe('false-positive-near-conflict');
    const catScore = score.findingsByCategory['false-positive-near-conflict']!;
    expect(catScore.truePositives).toBe(0);
    expect(catScore.falsePositives).toBe(1);
    expect(catScore.precision).toBe(0);
  });

  it('contradiction finding with zero evidence overlap in multi-contradiction fixture remains unclassified without category attribution', () => {
    const groundTruth: NormalizedGroundTruth = {
      expectedRequirements: [],
      expectedFindings: [
        {
          findingKey: 'FIND-THRESH-01',
          category: 'contradictory-approval-thresholds',
          type: 'contradiction',
          evidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }],
          declaredEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }],
          normalizedEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }],
          relatedRequirementKeys: []
        },
        {
          findingKey: 'FIND-AUTH-01',
          category: 'source-authority-conflict',
          type: 'contradiction',
          evidence: [{ sourceRevisionId: 'SRC-02-R1', locator: 'sec-2#2.1' }],
          declaredEvidence: [{ sourceRevisionId: 'SRC-02-R1', locator: 'sec-2#2.1' }],
          normalizedEvidence: [{ sourceRevisionId: 'SRC-02-R1', locator: 'sec-2#2.1' }],
          relatedRequirementKeys: []
        }
      ],
      expectedNonFindings: []
    };

    // Completely unrelated stray contradiction with no evidence overlap to either category
    const strayFinding = createCandidateFinding({
      id: createFindingId('FIND-AMBIGUOUS-01'),
      type: 'contradiction',
      affectedRequirementRevisions: [],
      evidence: [
        createEvidenceReference(
          createSourceRevisionId('SRC-99-R1'),
          createEvidenceLocator('sec-99#9.9')
        )
      ],
      discoveredBy: 'model',
      disposition: 'OPEN'
    });

    const score = scoreFixture({
      groundTruth,
      observedRequirements: [],
      observedFindings: [strayFinding]
    });

    expect(score.unclassifiedFindingsCount).toBe(1);
    expect(score.unclassifiedFindings[0].category).toBeUndefined();
    // Neither contradiction category receives a false positive without evidence overlap
    expect(score.findingsByCategory['contradictory-approval-thresholds']!.falsePositives).toBe(0);
    expect(score.findingsByCategory['source-authority-conflict']!.falsePositives).toBe(0);
  });

  it('statement pattern mismatch records diagnostic but does NOT alter structural True Positive', () => {
    const groundTruth: NormalizedGroundTruth = {
      expectedRequirements: [
        {
          requirementKey: 'REQ-01',
          category: 'business-rule',
          origin: 'EXPLICIT',
          statementPattern: 'purchase orders over \\$10,000',
          evidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }],
          declaredEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }],
          normalizedEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }]
        }
      ],
      expectedFindings: [],
      expectedNonFindings: []
    };

    // Statement doesn't match the pattern
    const observedRequirement = createRequirementRevision({
      id: createRequirementRevisionId('REQ-OBS-01-R1'),
      requirementId: createRequirementId('REQ-OBS-01'),
      revision: 1,
      statement: 'Threshold is set to 5000 dollars',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'PENDING',
      resolutionState: 'UNRESOLVED',
      evidence: [baseEvidenceRef]
    });

    const score = scoreFixture({
      groundTruth,
      observedRequirements: [observedRequirement],
      observedFindings: []
    });

    // Still a True Positive structurally!
    expect(score.matchedRequirements).toHaveLength(1);
    expect(score.requirementsByCategory['business-rule']!.truePositives).toBe(1);
    expect(score.requirementsByCategory['business-rule']!.precision).toBe(1);
    expect(score.requirementsByCategory['business-rule']!.recall).toBe(1);

    // Diagnostic captured the pattern failure
    expect(score.matchedRequirements[0].statementPatternDiagnostic).toEqual({
      pattern: 'purchase orders over \\$10,000',
      matched: false
    });
  });

  it('null denominator semantics for empty categories', () => {
    const groundTruth: NormalizedGroundTruth = {
      expectedRequirements: [],
      expectedFindings: [],
      expectedNonFindings: []
    };

    const score = scoreFixture({
      groundTruth,
      observedRequirements: [],
      observedFindings: []
    });

    const catScore = score.requirementsByCategory['business-rule']!;
    expect(catScore.truePositives).toBe(0);
    expect(catScore.falsePositives).toBe(0);
    expect(catScore.falseNegatives).toBe(0);
    expect(catScore.precision).toBeNull();
    expect(catScore.recall).toBeNull();
    expect(catScore.f1Score).toBeNull();
  });

  it('finding with expected target plus an unknown extra target does not match (treated as mismatch)', () => {
    const groundTruth: NormalizedGroundTruth = {
      expectedRequirements: [
        {
          requirementKey: 'REQ-01',
          category: 'business-rule',
          origin: 'EXPLICIT',
          evidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }],
          declaredEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }],
          normalizedEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }]
        }
      ],
      expectedFindings: [
        {
          findingKey: 'FIND-01',
          category: 'contradictory-approval-thresholds',
          type: 'contradiction',
          evidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }],
          declaredEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }],
          normalizedEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }],
          relatedRequirementKeys: ['REQ-01']
        }
      ],
      expectedNonFindings: []
    };

    const req1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-OBS-01-R1'),
      requirementId: createRequirementId('REQ-OBS-01'),
      revision: 1,
      statement: 'Req 1',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'PENDING',
      resolutionState: 'UNRESOLVED',
      evidence: [baseEvidenceRef]
    });

    const obsFinding = createCandidateFinding({
      id: createFindingId('FIND-OBS-01'),
      type: 'contradiction',
      affectedRequirementRevisions: [req1.id],
      evidence: [baseEvidenceRef],
      discoveredBy: 'model',
      disposition: 'OPEN'
    });

    // Model raw response had ['REQ-01', 'REQ-EXTRA-UNKNOWN']
    const rawFinding = {
      findingKey: 'FIND-RAW-01',
      type: 'contradiction' as const,
      relatedRequirementKeys: ['REQ-01', 'REQ-EXTRA-UNKNOWN'],
      evidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }],
      rationale: 'Contradiction with extra unknown target'
    };

    const score = scoreFixture({
      groundTruth,
      observedRequirements: [req1],
      observedFindings: [obsFinding],
      rawFindings: [rawFinding]
    });

    // Must NOT award True Positive because model returned an extra unmapped requirement key
    expect(score.matchedFindings).toHaveLength(0);
    expect(score.findingsByCategory['contradictory-approval-thresholds']!.truePositives).toBe(0);
    expect(score.findingsByCategory['contradictory-approval-thresholds']!.falsePositives).toBe(1);
    expect(score.findingsByCategory['contradictory-approval-thresholds']!.falseNegatives).toBe(1);
    expect(score.findingsByCategory['contradictory-approval-thresholds']!.precision).toBe(0);
  });

  it('scores data-boundary-ambiguity and subjective-normative-language as scoreable categories (True Positives)', () => {
    const groundTruth: NormalizedGroundTruth = {
      expectedRequirements: [
        {
          requirementKey: 'REQ-01',
          category: 'business-rule',
          origin: 'EXPLICIT',
          evidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }],
          declaredEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }],
          normalizedEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-1#1.1' }]
        }
      ],
      expectedFindings: [
        {
          findingKey: 'FIND-BOUND-01',
          category: 'data-boundary-ambiguity',
          type: 'data-boundary-ambiguity',
          evidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-2#2.1' }],
          declaredEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-2#2.1' }],
          normalizedEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-2#2.1' }],
          relatedRequirementKeys: ['REQ-01']
        },
        {
          findingKey: 'FIND-SUBJ-01',
          category: 'subjective-normative-language',
          type: 'subjective-normative-language',
          evidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-3#3.1' }],
          declaredEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-3#3.1' }],
          normalizedEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-3#3.1' }],
          relatedRequirementKeys: ['REQ-01']
        }
      ],
      expectedNonFindings: []
    };

    const req1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-OBS-01-R1'),
      requirementId: createRequirementId('REQ-OBS-01'),
      revision: 1,
      statement: 'Req 1',
      category: 'business-rule',
      origin: 'EXPLICIT',
      reviewState: 'PENDING',
      resolutionState: 'UNRESOLVED',
      evidence: [baseEvidenceRef]
    });

    const boundObsFinding = createCandidateFinding({
      id: createFindingId('FIND-OBS-BOUND-01'),
      type: 'data-boundary-ambiguity',
      affectedRequirementRevisions: [req1.id],
      evidence: [
        createEvidenceReference(
          createSourceRevisionId('SRC-01-R1'),
          createEvidenceLocator('sec-2#2.1')
        )
      ],
      discoveredBy: 'model',
      disposition: 'OPEN'
    });

    const subjObsFinding = createCandidateFinding({
      id: createFindingId('FIND-OBS-SUBJ-01'),
      type: 'subjective-normative-language',
      affectedRequirementRevisions: [req1.id],
      evidence: [
        createEvidenceReference(
          createSourceRevisionId('SRC-01-R1'),
          createEvidenceLocator('sec-3#3.1')
        )
      ],
      discoveredBy: 'model',
      disposition: 'OPEN'
    });

    const score = scoreFixture({
      groundTruth,
      observedRequirements: [req1],
      observedFindings: [boundObsFinding, subjObsFinding]
    });

    expect(score.unclassifiedFindingsCount).toBe(0);
    expect(score.matchedFindings).toHaveLength(2);

    const boundScore = score.findingsByCategory['data-boundary-ambiguity']!;
    expect(boundScore.truePositives).toBe(1);
    expect(boundScore.falsePositives).toBe(0);
    expect(boundScore.falseNegatives).toBe(0);
    expect(boundScore.precision).toBe(1);

    const subjScore = score.findingsByCategory['subjective-normative-language']!;
    expect(subjScore.truePositives).toBe(1);
    expect(subjScore.falsePositives).toBe(0);
    expect(subjScore.falseNegatives).toBe(0);
    expect(subjScore.precision).toBe(1);
  });

  it('scores expectedNonFindings for data-boundary-ambiguity and subjective-normative-language without unclassified fall-through', () => {
    const groundTruth: NormalizedGroundTruth = {
      expectedRequirements: [],
      expectedFindings: [],
      expectedNonFindings: [
        {
          description: 'Resolved inclusive boundary',
          category: 'data-boundary-ambiguity',
          wouldBeType: 'data-boundary-ambiguity',
          evidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-2#2.2' }],
          declaredEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-2#2.2' }],
          normalizedEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-2#2.2' }]
        },
        {
          description: 'Explicit quantitative response threshold',
          category: 'subjective-normative-language',
          wouldBeType: 'subjective-normative-language',
          evidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-3#3.2' }],
          declaredEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-3#3.2' }],
          normalizedEvidence: [{ sourceRevisionId: 'SRC-01-R1', locator: 'sec-3#3.2' }]
        }
      ]
    };

    const boundObsFinding = createCandidateFinding({
      id: createFindingId('FIND-OBS-BOUND-02'),
      type: 'data-boundary-ambiguity',
      affectedRequirementRevisions: [],
      evidence: [
        createEvidenceReference(
          createSourceRevisionId('SRC-01-R1'),
          createEvidenceLocator('sec-2#2.2')
        )
      ],
      discoveredBy: 'model',
      disposition: 'OPEN'
    });

    const subjObsFinding = createCandidateFinding({
      id: createFindingId('FIND-OBS-SUBJ-02'),
      type: 'subjective-normative-language',
      affectedRequirementRevisions: [],
      evidence: [
        createEvidenceReference(
          createSourceRevisionId('SRC-01-R1'),
          createEvidenceLocator('sec-3#3.2')
        )
      ],
      discoveredBy: 'model',
      disposition: 'OPEN'
    });

    const score = scoreFixture({
      groundTruth,
      observedRequirements: [],
      observedFindings: [boundObsFinding, subjObsFinding]
    });

    expect(score.unclassifiedFindingsCount).toBe(0);
    expect(score.matchedFindings).toHaveLength(0);
    expect(score.mismatchedFindings).toHaveLength(2);

    const boundMismatch = score.mismatchedFindings.find(
      (m) => m.category === 'data-boundary-ambiguity'
    );
    expect(boundMismatch?.type).toBe('matched-expected-non-finding');

    const subjMismatch = score.mismatchedFindings.find(
      (m) => m.category === 'subjective-normative-language'
    );
    expect(subjMismatch?.type).toBe('matched-expected-non-finding');

    expect(score.findingsByCategory['data-boundary-ambiguity']!.falsePositives).toBe(1);
    expect(score.findingsByCategory['subjective-normative-language']!.falsePositives).toBe(1);
  });

  it('maps unmatched observed findings of these types to their categories via TYPE_TO_CATEGORY_MAP fallback', () => {
    const groundTruth: NormalizedGroundTruth = {
      expectedRequirements: [],
      expectedFindings: [],
      expectedNonFindings: []
    };

    const boundObsFinding = createCandidateFinding({
      id: createFindingId('FIND-OBS-BOUND-03'),
      type: 'data-boundary-ambiguity',
      affectedRequirementRevisions: [],
      evidence: [
        createEvidenceReference(
          createSourceRevisionId('SRC-01-R1'),
          createEvidenceLocator('unknown-section#9.9')
        )
      ],
      discoveredBy: 'model',
      disposition: 'OPEN'
    });

    const score = scoreFixture({
      groundTruth,
      observedRequirements: [],
      observedFindings: [boundObsFinding]
    });

    expect(score.unclassifiedFindingsCount).toBe(1);
    expect(score.mismatchedFindings).toHaveLength(1);
    expect(score.mismatchedFindings[0].type).toBe('unclassified-observed');
    expect(score.mismatchedFindings[0].category).toBe('data-boundary-ambiguity');
    expect(score.findingsByCategory['data-boundary-ambiguity']!.falsePositives).toBe(1);
  });
});
