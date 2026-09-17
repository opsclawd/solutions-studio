import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { runPhase1ExitGate } from '../../src/application/harness/runPhase1ExitGate.js';
import { createPhase1TestAdapter } from '../harness/createPhase1ExitGateAdapter.js';
import { runEvaluation } from '../../src/infrastructure/evaluation/runEvaluation.js';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';

describe('Phase 1.7 — End-to-End Baseline Projection & Exit Gate Witness', () => {
  it('executes complete Phase 1 integration workflow: import messy package -> compile -> reconcile -> lineage block -> baseline -> restart reload -> repaired Mermaid projection -> evaluation report', async () => {
    const result = await runPhase1ExitGate({
      silent: true,
      adapter: createPhase1TestAdapter()
    });

    // 1. Ingestion & locator index assertions
    expect(result.success).toBe(true);
    expect(result.capturedSourceRevisionCount).toBe(4);

    // 2. Compilation assertions
    expect(result.compiledRequirementCount).toBe(13);
    expect(result.compiledFindingCount).toBe(11);

    // 3. Human reconciliation assertions
    expect(result.acceptedRequirementCount).toBe(11);
    expect(result.rejectedRequirementCount).toBe(2);
    expect(result.dispositionedFindingCount).toBe(11);

    // 4. Immutable baseline assertions
    expect(result.baseline.id).toBe('BASE-CANONICAL-MESSY-001');
    expect(result.baseline.requirementRevisions).toHaveLength(11);

    // 5. Restart reload durability assertions
    expect(result.reloadedBaseline.id).toBe('BASE-CANONICAL-MESSY-001');
    expect(result.reloadedBaseline.requirementRevisions).toEqual(
      result.baseline.requirementRevisions
    );

    // 6. Baseline projection & closed-loop repair assertions
    expect(result.projectionResult.content).toContain('Start Telemetry Processing');
    expect(result.projectionResult.content).toContain('Complete Archival');
    expect(result.projectionResult.metadata.baselineId).toBe('BASE-CANONICAL-MESSY-001');
    expect(result.projectionResult.metadata.requirementRevisionIds).toEqual(
      result.baseline.requirementRevisions
    );
    expect(result.projectionResult.metadata.configuredExecution.provider).toBe('fake');
    expect(result.projectionResult.metadata.configuredExecution.artifactType).toBe(
      'process-diagram'
    );
    expect(result.projectionResult.metadata.measuredVerification.repairsNeeded).toBe(1);
    expect(result.projectionResult.metadata.measuredVerification.attemptCount).toBe(2);
    expect(result.projectionResult.repairHistory).toHaveLength(1);

    // 7. Evaluation runner report assertions
    expect(result.evaluationReport.corpusVersion).toBe('v1.0');
    expect(result.evaluationReport.corpusIdentity).toMatch(/^[a-f0-9]{64}$/);
    expect(result.evaluationReport.aggregateScores.totalFixtures).toBe(16);
    expect(result.evaluationReport.aggregateScores.completedFixtures).toBe(16);
    expect(result.evaluationReport.aggregateScores.failedFixtures).toBe(0);

    const canonicalResult = result.evaluationReport.fixtureResults.find(
      (f) => f.fixtureId === 'canonical-messy-discovery-package'
    );
    expect(canonicalResult).toBeDefined();
    expect(canonicalResult!.status).toBe('completed');
    if (canonicalResult!.status === 'completed') {
      expect(canonicalResult!.executed.rejectedRequirementCount).toBe(0);
      expect(canonicalResult!.executed.rejectedFindingCount).toBe(0);
    }

    // 8. Durability of evaluation run
    expect(result.reloadedEvaluationRun.id).toBe(result.evaluationReport.runId);
    expect(result.reloadedEvaluationRun.corpusVersion).toBe('v1.0');
  });

  it('evaluation runner produces deterministic/versioned Phase 1 JSON/MD reports and persisted record reloads cleanly', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'exit-gate-eval-test-'));
    try {
      const repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
      const reportJsonPath = path.join(tempDir, 'custom-report.json');
      const reportMdPath = path.join(tempDir, 'custom-report.md');

      const evalResult = await runEvaluation({
        provider: 'fixture-replay',
        outputReportPath: reportJsonPath,
        outputMarkdownPath: reportMdPath,
        repository: repo,
        candidateSha: 'abc1234def5678',
        storeDir: path.join(tempDir, 'fixtures')
      });

      expect(evalResult.success).toBe(true);
      expect(evalResult.report.corpusVersion).toBe('v1.0');
      expect(evalResult.report.candidateSha.status).toBe('available');
      if (evalResult.report.candidateSha.status === 'available') {
        expect(evalResult.report.candidateSha.value).toBe('abc1234def5678');
      }

      // Assert JSON file on disk
      const rawJson = await fs.readFile(reportJsonPath, 'utf-8');
      const parsedJson = JSON.parse(rawJson);
      expect(parsedJson.corpusVersion).toBe('v1.0');
      expect(parsedJson.aggregateScores.totalFixtures).toBe(16);
      expect(parsedJson.aggregateScores.completedFixtures).toBe(16);

      // Assert Markdown file on disk
      const rawMd = await fs.readFile(reportMdPath, 'utf-8');
      expect(rawMd).toContain('# Requirements Intelligence Compiler Evaluation Report');
      expect(rawMd).toContain('abc1234def5678');
      expect(rawMd).toContain('canonical-messy-discovery-package');

      // Assert reload from repository
      const reloadedRun = await repo.getEvaluationRun(evalResult.runRecord.id);
      expect(reloadedRun).toBeDefined();
      expect(reloadedRun!.id).toBe(evalResult.runRecord.id);
      expect(reloadedRun!.report.runId).toBe(evalResult.report.runId);
      expect(reloadedRun!.report.corpusIdentity).toBe(evalResult.report.corpusIdentity);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
