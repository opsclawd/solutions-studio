import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runEvaluation } from '../../src/infrastructure/evaluation/runEvaluation.js';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { parseArgs } from '../../scripts/run-evaluation.js';

describe('Evaluation CLI options and reload integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-eval-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('runs deterministic evaluation and reloads persisted run from brand new repository instance', async () => {
    const storeDir = path.join(tempDir, 'repo-store');
    const repoA = new FilesystemRequirementsRepository({ baseDir: storeDir });
    const jsonPath = path.join(tempDir, 'output.json');
    const mdPath = path.join(tempDir, 'output.md');

    const result = await runEvaluation({
      repository: repoA,
      candidateSha: 'candidate-commit-sha-456',
      storeDir: path.join(storeDir, 'fixtures'),
      outputReportPath: jsonPath,
      outputMarkdownPath: mdPath,
      provider: 'fixture-replay'
    });

    expect(result.success).toBe(true);
    const runId = result.runRecord.id;

    // Instantiate a brand new repository instance B over the exact same storeDir (simulating fresh process)
    const repoB = new FilesystemRequirementsRepository({ baseDir: storeDir });
    const reloaded = await repoB.getEvaluationRun(runId);

    expect(reloaded).toBeDefined();
    expect(reloaded!.id).toBe(runId);
    expect(reloaded!.corpusVersion).toBe('v2.0');
    expect(reloaded!.fixtureResults).toHaveLength(16);
    expect(reloaded!.report.candidateSha).toEqual({
      status: 'available',
      value: 'candidate-commit-sha-456'
    });
    expect(reloaded!.report.provenance.verified.persistenceVerified).toBe(true);
    expect(reloaded!.report.provenance.requested.providerMode).toBe('fixture-replay');

    // Check on-disk JSON report matches
    const jsonContent = await fs.readFile(jsonPath, 'utf8');
    const parsed = JSON.parse(jsonContent);
    expect(parsed.runId).toBe(runId);
    expect(parsed.candidateSha).toEqual({
      status: 'available',
      value: 'candidate-commit-sha-456'
    });

    // Check on-disk MD report
    const mdContent = await fs.readFile(mdPath, 'utf8');
    expect(mdContent).toContain(runId);
    expect(mdContent).toContain('candidate-commit-sha-456');
  });

  it('reports failure when live provider fails without falling back to replay', async () => {
    // Providing a failing live gateway configuration (e.g. invalid agy bin path)
    const storeDir = path.join(tempDir, 'live-fail-store');
    const repo = new FilesystemRequirementsRepository({ baseDir: storeDir });

    const failingLiveGateway = {
      async generate() {
        throw new Error('AGY CLI exited with code 127: command not found');
      }
    };

    const result = await runEvaluation({
      repository: repo,
      customGateway: failingLiveGateway as any,
      storeDir: path.join(storeDir, 'fixtures'),
      provider: 'agy'
    });

    expect(result.success).toBe(false);
    expect(result.report.aggregateScores.failedFixtures).toBe(16);
    expect(result.report.aggregateScores.completedFixtures).toBe(0);

    const firstFailed = result.report.fixtureResults[0];
    expect(firstFailed.status).toBe('failed');
    if (firstFailed.status === 'failed') {
      expect(firstFailed.error.message).toContain('command not found');
    }
  });

  describe('CLI strict argument parsing', () => {
    it('parses valid options successfully', () => {
      const parsed = parseArgs([
        '--provider',
        'agy',
        '--agy-bin',
        '/usr/local/bin/agy',
        '--timeout',
        '10000',
        '--candidate-sha',
        'commit-abc-123'
      ]);

      expect(parsed.provider).toBe('agy');
      expect(parsed.agyBinPath).toContain('/usr/local/bin/agy');
      expect(parsed.timeoutMs).toBe(10000);
      expect(parsed.candidateSha).toBe('commit-abc-123');
    });

    it('rejects unknown option flags', () => {
      expect(() => parseArgs(['--unknown-flag', 'value'])).toThrow(
        /Unknown option: '--unknown-flag'/
      );
    });

    it('rejects positional arguments', () => {
      expect(() => parseArgs(['unexpected-argument'])).toThrow(
        /Unexpected positional argument: 'unexpected-argument'/
      );
    });

    it('rejects missing values at end of arguments', () => {
      expect(() => parseArgs(['--provider'])).toThrow(/Option '--provider' requires a value/);
    });

    it('rejects missing values preceding another option flag', () => {
      expect(() => parseArgs(['--provider', '--candidate-sha', '123'])).toThrow(
        /Option '--provider' requires a value/
      );
    });

    it('rejects duplicate options', () => {
      expect(() => parseArgs(['--provider', 'fixture-replay', '--provider', 'opencode'])).toThrow(
        /Duplicate option: '--provider'/
      );
    });

    it('rejects non-integer, zero, or negative timeouts', () => {
      expect(() => parseArgs(['--timeout', '0'])).toThrow(/must be a positive integer/);
      expect(() => parseArgs(['--timeout', '-500'])).toThrow(/must be a positive integer/);
      expect(() => parseArgs(['--timeout', 'not-a-number'])).toThrow(/must be a positive integer/);
      expect(() => parseArgs(['--timeout', '12.34'])).toThrow(/must be a positive integer/);
    });

    it('rejects invalid providers', () => {
      expect(() => parseArgs(['--provider', 'invalid-provider'])).toThrow(
        /Invalid provider 'invalid-provider'/
      );
    });

    it('rejects provider-specific options for mismatched providers', () => {
      expect(() => parseArgs(['--provider', 'fixture-replay', '--agy-bin', '/bin/agy'])).toThrow(
        /Option '--agy-bin' is only valid when provider is 'agy'/
      );

      expect(() => parseArgs(['--provider', 'agy', '--opencode-bin', '/bin/opencode'])).toThrow(
        /Option '--opencode-bin' is only valid when provider is 'opencode'/
      );
    });

    it('parses --model option for agy provider', () => {
      const parsed = parseArgs(['--provider', 'agy', '--model', 'gemini-3.1-pro-high']);
      expect(parsed.provider).toBe('agy');
      expect(parsed.modelName).toBe('gemini-3.1-pro-high');
    });

    it('parses --model option for opencode provider', () => {
      const parsed = parseArgs([
        '--provider',
        'opencode',
        '--model',
        'minimax-coding-plan/MiniMax-M3'
      ]);
      expect(parsed.provider).toBe('opencode');
      expect(parsed.modelName).toBe('minimax-coding-plan/MiniMax-M3');
    });

    it('rejects --model option when provider is fixture-replay', () => {
      expect(() =>
        parseArgs(['--provider', 'fixture-replay', '--model', 'gemini-3.1-pro-high'])
      ).toThrow(
        /Option '--model' is only valid when provider is 'agy' or 'opencode', got 'fixture-replay'/
      );
    });
  });
});
