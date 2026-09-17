import { describe, it, expect } from 'vitest';
import { renderHumanReport } from '../../src/application/evaluation/renderEvaluationReport.js';
import type { EvaluationReportDto } from '@solutions-studio/contracts';

function createMockReport(
  providerMode: 'fixture-replay' | 'agy' | 'opencode'
): EvaluationReportDto {
  return {
    runId: 'RUN-TEST-001',
    corpusVersion: 'v1.0',
    corpusIdentity: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    executedAt: '2026-09-17T12:00:00.000Z',
    candidateSha: { status: 'available', value: 'c5daae1285dcb2f08960abf2f7deb9b9d7d1d662' },
    summary: {
      totalFixtures: 1,
      passedFixtures: 1,
      failedFixtures: 0,
      coveredCategories: ['contradictory-approval-thresholds']
    },
    aggregateScores: {
      totalFixtures: 1,
      completedFixtures: 1,
      failedFixtures: 0,
      requirementsByCategory: {
        'business-rule': {
          truePositives: 1,
          falsePositives: 0,
          falseNegatives: 0,
          precision: 1,
          recall: 1,
          f1Score: 1
        },
        constraint: {
          truePositives: 0,
          falsePositives: 0,
          falseNegatives: 0,
          precision: null,
          recall: null,
          f1Score: null
        },
        'system-capability': {
          truePositives: 0,
          falsePositives: 0,
          falseNegatives: 0,
          precision: null,
          recall: null,
          f1Score: null
        },
        'integration-contract': {
          truePositives: 0,
          falsePositives: 0,
          falseNegatives: 0,
          precision: null,
          recall: null,
          f1Score: null
        },
        'data-definition': {
          truePositives: 0,
          falsePositives: 0,
          falseNegatives: 0,
          precision: null,
          recall: null,
          f1Score: null
        },
        'operational-quality': {
          truePositives: 0,
          falsePositives: 0,
          falseNegatives: 0,
          precision: null,
          recall: null,
          f1Score: null
        }
      },
      findingsByCategory: {
        'contradictory-approval-thresholds': {
          truePositives: 1,
          falsePositives: 0,
          falseNegatives: 0,
          precision: 1,
          recall: 1,
          f1Score: 1
        },
        'missing-actors-authorization': {
          truePositives: 0,
          falsePositives: 0,
          falseNegatives: 0,
          precision: null,
          recall: null,
          f1Score: null
        },
        'incomplete-state-transitions': {
          truePositives: 0,
          falsePositives: 0,
          falseNegatives: 0,
          precision: null,
          recall: null,
          f1Score: null
        },
        'missing-failure-recovery': {
          truePositives: 0,
          falsePositives: 0,
          falseNegatives: 0,
          precision: null,
          recall: null,
          f1Score: null
        },
        'temporal-ambiguity': {
          truePositives: 0,
          falsePositives: 0,
          falseNegatives: 0,
          precision: null,
          recall: null,
          f1Score: null
        },
        'undefined-cardinality': {
          truePositives: 0,
          falsePositives: 0,
          falseNegatives: 0,
          precision: null,
          recall: null,
          f1Score: null
        },
        'unsupported-assumptions': {
          truePositives: 0,
          falsePositives: 0,
          falseNegatives: 0,
          precision: null,
          recall: null,
          f1Score: null
        },
        'superseded-source-or-requirement': {
          truePositives: 0,
          falsePositives: 0,
          falseNegatives: 0,
          precision: null,
          recall: null,
          f1Score: null
        },
        'source-authority-conflict': {
          truePositives: 0,
          falsePositives: 0,
          falseNegatives: 0,
          precision: null,
          recall: null,
          f1Score: null
        },
        'false-positive-near-conflict': {
          truePositives: 0,
          falsePositives: 0,
          falseNegatives: 0,
          precision: null,
          recall: null,
          f1Score: null
        }
      },
      unclassifiedFindingsCount: 0
    },
    fixtureResults: [
      {
        fixtureId: 'approval-threshold-contradiction-basic',
        status: 'completed',
        executed: {
          providerMetadata: {
            status: 'available',
            value: {
              provider: providerMode,
              model: 'test-model',
              durationMs: 100
            }
          }
        },
        measured: {
          durationMs: 100,
          score: {
            requirementsByCategory: {} as any,
            findingsByCategory: {} as any,
            unclassifiedFindingsCount: 0,
            matchedRequirements: [],
            mismatchedRequirements: [],
            matchedFindings: [],
            mismatchedFindings: [],
            unclassifiedFindings: [],
            rejectedCompilerRequirements: [],
            rejectedCompilerFindings: []
          }
        },
        sourceLineageMap: []
      }
    ],
    provenance: {
      requested: {
        providerMode,
        candidateSha: 'c5daae1285dcb2f08960abf2f7deb9b9d7d1d662'
      },
      declared: {
        corpusManifestPath: 'test/manifest.json',
        fixtureCount: 1,
        declaredFixtures: []
      },
      configured: {
        compilerVersion: '0.1.0',
        promptVersion: '1.0',
        nodeVersion: 'v20.0.0',
        platform: 'linux',
        arch: 'x64'
      },
      verified: {
        corpusIdentityHash: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        fixturesEvaluatedCount: 1,
        persistenceVerified: true
      }
    }
  } as unknown as EvaluationReportDto;
}

describe('renderEvaluationReport', () => {
  it('renders deterministic replay self-check notice for fixture-replay provider', () => {
    const report = createMockReport('fixture-replay');
    const rendered = renderHumanReport(report);

    expect(rendered).toContain('## Deterministic Replay Self-Check Notice');
    expect(rendered).toContain(
      'This report reflects a deterministic replay self-check (smoke test).'
    );
    expect(rendered).toContain('this is not an empirical provider baseline');
    expect(rendered).not.toContain('## Empirical Baseline Notice');
    expect(rendered).not.toContain('This report reflects empirical versioned corpus evaluation');
  });

  it('renders empirical baseline notice for agy provider', () => {
    const report = createMockReport('agy');
    const rendered = renderHumanReport(report);

    expect(rendered).toContain('## Empirical Baseline Notice');
    expect(rendered).toContain('This report reflects empirical versioned corpus evaluation');
    expect(rendered).not.toContain('## Deterministic Replay Self-Check Notice');
    expect(rendered).not.toContain('smoke test');
  });

  it('renders empirical baseline notice for opencode provider', () => {
    const report = createMockReport('opencode');
    const rendered = renderHumanReport(report);

    expect(rendered).toContain('## Empirical Baseline Notice');
    expect(rendered).toContain('This report reflects empirical versioned corpus evaluation');
    expect(rendered).not.toContain('## Deterministic Replay Self-Check Notice');
    expect(rendered).not.toContain('smoke test');
  });
});
