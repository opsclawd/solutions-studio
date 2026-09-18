import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { canonicalizeReportForDigest } from '@solutions-studio/contracts';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import {
  ImmutableRecordConflictError,
  type EvaluationRunRecord
} from '../../src/application/ports/persistence/IRequirementsRepository.js';
import {
  runEvaluation,
  createDefaultEvaluationPorts
} from '../../src/infrastructure/evaluation/runEvaluation.js';
import { EvaluateRequirementsCompilerUseCase } from '../../src/application/evaluation/EvaluateRequirementsCompilerUseCase.js';
import { FixtureReplayGenerationGateway } from '../../src/infrastructure/generation/FixtureReplayGenerationGateway.js';

describe('EvaluationRunner and EvaluateRequirementsCompilerUseCase', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-runner-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('runs evaluation across all 16 corpus fixtures, persists run record, and writes reports', async () => {
    const reportPath = path.join(tempDir, 'reports', 'evaluation-report.json');
    const markdownPath = path.join(tempDir, 'reports', 'evaluation-report.md');

    const { runRecord, report, humanReport, success } = await runEvaluation({
      repository: repo,
      candidateSha: 'test-sha-12345',
      outputReportPath: reportPath,
      outputMarkdownPath: markdownPath,
      storeDir: path.join(tempDir, 'eval-fixtures')
    });

    expect(success).toBe(true);
    expect(runRecord.corpusVersion).toBe('v2.0');
    expect(runRecord.fixtureResults.length).toBe(16);
    expect(report.candidateSha).toEqual({ status: 'available', value: 'test-sha-12345' });
    expect(report.summary.totalFixtures).toBe(16);
    expect(report.summary.passedFixtures).toBe(16);
    expect(report.summary.failedFixtures).toBe(0);
    expect(report.summary.coveredCategories.length).toBe(12);

    // Verify canonical-messy-discovery-package source lineage mapping
    const messyResult = report.fixtureResults.find(
      (f) => f.fixtureId === 'canonical-messy-discovery-package'
    );
    expect(messyResult).toBeDefined();
    expect(messyResult?.status).toBe('completed');
    if (messyResult?.status === 'completed') {
      const lineage = messyResult.sourceLineageMap;
      const messyR2Entry = lineage.find((e) => e.declaredRevisionId === 'MESSY-SOP-001-R2');
      expect(messyR2Entry).toBeDefined();
      expect(messyR2Entry?.capturedRevisionId).toBe('CORE-SOP-001-R2');
      expect(messyR2Entry?.declaredPredecessorAlias).toBe('MESSY-SOP-001-R1');
      expect(messyR2Entry?.capturedPredecessorId).toBe('CORE-SOP-001-R1');
      expect(messyR2Entry?.declaredOrdinal).toBe(2);
      expect(messyR2Entry?.capturedOrdinal).toBe(2);
    }

    // Verify all 12 defect categories have score counters in aggregate
    for (const [cat, counters] of Object.entries(report.aggregateScores.findingsByCategory)) {
      if (cat === 'false-positive-near-conflict') {
        // Negative-only defect category: tested via expected non-findings
        expect(counters.truePositives).toBe(0);
        expect(counters.falsePositives).toBe(0);
      } else {
        expect(counters.truePositives).toBeGreaterThanOrEqual(1);
      }
      expect(counters.falseNegatives).toBe(0);
    }

    // Verify persisted in repository and reloaded
    const persisted = await repo.getEvaluationRun(runRecord.id);
    expect(persisted).toBeDefined();
    expect(persisted!.corpusVersion).toBe('v2.0');
    expect(persisted!.fixtureResults.length).toBe(16);
    expect(persisted!.report.provenance.verified.persistenceVerified).toBe(true);

    // Verify report written to disk
    const reportFile = await fs.readFile(reportPath, 'utf8');
    const parsed = JSON.parse(reportFile);
    expect(parsed.corpusVersion).toBe('v2.0');
    expect(parsed.candidateSha).toEqual({ status: 'available', value: 'test-sha-12345' });
    expect(parsed.aggregateScores.totalFixtures).toBe(16);

    // Verify human markdown report
    const mdFile = await fs.readFile(markdownPath, 'utf8');
    expect(mdFile).toContain('# Requirements Intelligence Compiler Evaluation Report');
    expect(mdFile).toContain('test-sha-12345');
    expect(mdFile).toContain('contradictory-approval-thresholds');
    expect(humanReport).toContain('Defect Finding Quality by Category');
  });

  it('captures fixture failure honestly without fabricating a pass and sanitizes errors', async () => {
    // Failing custom gateway that throws an error with ANSI sequences and potential secrets
    const failingGateway = {
      async generate() {
        throw new Error(
          '\u001b[31mSimulated gateway model failure with token: Bearer sk-1234567890abcdef1234567890\u001b[0m'
        );
      }
    };

    const result = await runEvaluation({
      customGateway: failingGateway as any,
      storeDir: path.join(tempDir, 'failing-eval-fixtures')
    });

    expect(result.success).toBe(false);
    expect(result.report.aggregateScores.failedFixtures).toBe(16);
    expect(result.report.aggregateScores.completedFixtures).toBe(0);

    const firstFailed = result.report.fixtureResults[0];
    expect(firstFailed.status).toBe('failed');
    if (firstFailed.status === 'failed') {
      expect(firstFailed.error.name).toBe('Error');
      expect(firstFailed.error.message).toContain('Simulated gateway model failure');
      // Verify ANSI sequence stripped and secret redacted
      expect(firstFailed.error.message).not.toContain('\u001b[31m');
      expect(firstFailed.error.message).not.toContain('sk-1234567890abcdef1234567890');
      expect(firstFailed.error.message).toContain('Bearer [REDACTED]');
      expect(firstFailed.error.phase).toBe('compile');
    }
  });

  it('handles unavailable candidateSha gracefully', async () => {
    const prevSha = process.env.CANDIDATE_SHA;
    delete process.env.CANDIDATE_SHA;
    try {
      const result = await runEvaluation({
        storeDir: path.join(tempDir, 'no-sha-eval')
      });

      expect(result.report.candidateSha.status).toBe('unavailable');
    } finally {
      if (prevSha !== undefined) {
        process.env.CANDIDATE_SHA = prevSha;
      }
    }
  });

  it('FixtureReplayGenerationGateway rejects prompts without revision headings or unknown IDs', async () => {
    const gateway = new FixtureReplayGenerationGateway();

    await expect(gateway.generate({ prompt: 'Invalid prompt without headings' })).rejects.toThrow(
      /no "### Source Revision:" headings found/
    );

    await expect(
      gateway.generate({
        prompt: '### Source Revision: UNKNOWN-REV-1\nSome text'
      })
    ).rejects.toThrow(/does not match any registered fixture/);
  });

  it('EvaluateRequirementsCompilerUseCase rejects missing ports', async () => {
    const useCase = new EvaluateRequirementsCompilerUseCase();
    await expect(useCase.execute()).rejects.toThrow(/port must be provided/);
  });

  it('EvaluateRequirementsCompilerUseCase can be executed with custom ports', async () => {
    const defaultPorts = createDefaultEvaluationPorts({
      storeDir: path.join(tempDir, 'custom-ports-store')
    });
    const useCase = new EvaluateRequirementsCompilerUseCase(defaultPorts);
    const result = await useCase.execute({
      candidateSha: 'custom-port-sha',
      storeDir: path.join(tempDir, 'custom-ports-store')
    });

    expect(result.success).toBe(true);
    expect(result.report.candidateSha).toEqual({ status: 'available', value: 'custom-port-sha' });
  });

  it('rejects overwrite of existing evaluation run ID enforcing write-once immutability', async () => {
    const storeDir = path.join(tempDir, 'immutability-store');
    const customRepo = new FilesystemRequirementsRepository({ baseDir: storeDir });

    const result = await runEvaluation({
      repository: customRepo,
      candidateSha: 'orig-sha-111',
      storeDir: path.join(storeDir, 'fixtures')
    });

    expect(result.success).toBe(true);
    const originalRunId = result.runRecord.id;

    // Craft a forged run record with same ID but different candidateSha and mutated scores
    const forgedRunRecord: EvaluationRunRecord = {
      ...result.runRecord,
      report: {
        ...result.runRecord.report,
        candidateSha: { status: 'available', value: 'forged-sha-999' },
        provenance: {
          ...result.runRecord.report.provenance,
          requested: {
            ...result.runRecord.report.provenance.requested,
            candidateSha: { status: 'available', value: 'forged-sha-999' }
          }
        }
      }
    };

    // Attempting to overwrite an existing evaluation run must reject with ImmutableRecordConflictError
    await expect(customRepo.saveEvaluationRun(forgedRunRecord)).rejects.toThrow(
      ImmutableRecordConflictError
    );

    // Verify reloaded record is the original unchanged record
    const reloaded = await customRepo.getEvaluationRun(originalRunId);
    expect(reloaded).toBeDefined();
    expect(reloaded!.report.candidateSha).toEqual({ status: 'available', value: 'orig-sha-111' });
  });

  it('verifies deterministic non-circular canonical digest computation across all artifacts', async () => {
    const reportPath = path.join(tempDir, 'digest-verify', 'report.json');
    const mdPath = path.join(tempDir, 'digest-verify', 'report.md');
    const storeDir = path.join(tempDir, 'digest-verify', 'store');
    const customRepo = new FilesystemRequirementsRepository({ baseDir: storeDir });

    const result = await runEvaluation({
      repository: customRepo,
      candidateSha: 'sha-digest-check',
      outputReportPath: reportPath,
      outputMarkdownPath: mdPath,
      storeDir: path.join(storeDir, 'fixtures')
    });

    const report = result.runRecord.report;

    // 1. Report verified.reportDigest matches canonicalizeReportForDigest SHA-256
    const canonicalString = canonicalizeReportForDigest(report);
    const computedDigest = crypto.createHash('sha256').update(canonicalString).digest('hex');
    expect(report.provenance.verified.reportDigest).toBe(computedDigest);

    // 2. jsonReportDigest matches the canonical report digest
    expect(report.reportArtifacts.jsonReportDigest.status).toBe('available');
    if (report.reportArtifacts.jsonReportDigest.status === 'available') {
      expect(report.reportArtifacts.jsonReportDigest.value).toBe(computedDigest);
    }

    // 3. markdownReportDigest matches sha256 of the emitted markdown file
    expect(report.reportArtifacts.markdownReportDigest.status).toBe('available');
    if (report.reportArtifacts.markdownReportDigest.status === 'available') {
      const mdContent = await fs.readFile(mdPath, 'utf8');
      const computedMdDigest = crypto.createHash('sha256').update(mdContent).digest('hex');
      expect(report.reportArtifacts.markdownReportDigest.value).toBe(computedMdDigest);
    }
  });

  it('enforces byte-equivalent validated equality between persisted, emitted, and returned reports', async () => {
    const reportPath = path.join(tempDir, 'equality-check', 'report.json');
    const storeDir = path.join(tempDir, 'equality-check', 'store');
    const customRepo = new FilesystemRequirementsRepository({ baseDir: storeDir });

    const result = await runEvaluation({
      repository: customRepo,
      candidateSha: 'sha-persisted-vs-emitted',
      outputReportPath: reportPath,
      storeDir: path.join(storeDir, 'fixtures')
    });

    const runId = result.runRecord.id;
    const reloaded = await customRepo.getEvaluationRun(runId);
    expect(reloaded).toBeDefined();

    const emittedJson = JSON.parse(await fs.readFile(reportPath, 'utf8'));

    // Persisted report vs returned runRecord.report
    expect(reloaded!.report).toEqual(result.runRecord.report);

    // Emitted report on disk vs returned runRecord.report
    expect(emittedJson).toEqual(result.runRecord.report);

    // Emitted report on disk vs persisted report in repository
    expect(emittedJson).toEqual(reloaded!.report);

    // Canonical digest computed on reloaded record and emitted file must be identical
    const reloadedDigest = crypto
      .createHash('sha256')
      .update(canonicalizeReportForDigest(reloaded!.report))
      .digest('hex');
    const emittedDigest = crypto
      .createHash('sha256')
      .update(canonicalizeReportForDigest(emittedJson))
      .digest('hex');

    expect(reloadedDigest).toBe(result.runRecord.report.provenance.verified.reportDigest);
    expect(emittedDigest).toBe(result.runRecord.report.provenance.verified.reportDigest);
  });
});
