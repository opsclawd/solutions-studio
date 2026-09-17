import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { runEvaluation } from '../../src/application/evaluation/EvaluationRunner.js';

describe('EvaluationRunner', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-runner-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('runs evaluation across corpus fixtures, persists run record, and writes deterministic report', async () => {
    const reportPath = path.join(tempDir, 'reports', 'evaluation-report.json');
    const { runRecord, report } = await runEvaluation({
      repository: repo,
      candidateSha: 'test-sha-12345',
      outputReportPath: reportPath
    });

    expect(runRecord.corpusVersion).toBe('v1.0');
    expect(runRecord.fixtureResults.length).toBe(14);
    expect(report.candidateSha).toBe('test-sha-12345');
    expect(report.summary.totalFixtures).toBe(14);
    expect(report.summary.passedFixtures).toBe(14);
    expect(report.summary.coveredCategories.length).toBe(10);

    // Verify persisted in repository
    const persisted = await repo.getEvaluationRun(runRecord.id);
    expect(persisted).toBeDefined();
    expect(persisted!.corpusVersion).toBe('v1.0');
    expect(persisted!.fixtureResults.length).toBe(14);

    // Verify report written to disk
    const reportFile = await fs.readFile(reportPath, 'utf8');
    const parsed = JSON.parse(reportFile);
    expect(parsed.corpusVersion).toBe('v1.0');
    expect(parsed.candidateSha).toBe('test-sha-12345');
    expect(parsed.summary.totalFixtures).toBe(14);
  });
});
