import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createRequirementId,
  createRequirementRevisionId,
  createRequirementsBaselineId,
  createReviewerId,
  createRequirementsBaseline,
  createRequirementRevision
} from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeGenerationGateway } from '../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../fakes/FakeMermaidLinterGateway.js';
import { MermaidCliLinterAdapter } from '../../src/infrastructure/validation/MermaidCliLinterAdapter.js';
import { AntigravityCliAdapter } from '../../src/infrastructure/generation/AntigravityCliAdapter.js';
import { OpenCodeCliAdapter } from '../../src/infrastructure/generation/OpenCodeCliAdapter.js';
import {
  parseArgs,
  composeProjectBaselineComponents,
  runProjectBaseline
} from '../../scripts/run-project-baseline.js';
import { UnknownRequirementsBaselineError } from '../../src/application/use-cases/ReconciliationErrors.js';

describe('ProjectBaseline CLI and composition', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-project-baseline-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('CLI strict argument parsing', () => {
    it('parses valid minimal required options successfully with default provider', () => {
      const parsed = parseArgs([
        '--baseline',
        'BASE-TEST-001',
        '--artifact-type',
        'process-diagram'
      ]);

      expect(parsed.baselineId).toBe('BASE-TEST-001');
      expect(parsed.artifactType).toBe('process-diagram');
      expect(parsed.provider).toBe('agy');
    });

    it('parses all valid options successfully', () => {
      const parsed = parseArgs([
        '--baseline',
        'BASE-CANONICAL-MESSY-001',
        '--artifact-type',
        'state-diagram',
        '--provider',
        'agy',
        '--store',
        'test-store-dir',
        '--timeout',
        '12000',
        '--agy-bin',
        '/usr/local/bin/agy'
      ]);

      expect(parsed.baselineId).toBe('BASE-CANONICAL-MESSY-001');
      expect(parsed.artifactType).toBe('state-diagram');
      expect(parsed.provider).toBe('agy');
      expect(parsed.storeDir).toBe(path.resolve(process.cwd(), 'test-store-dir'));
      expect(parsed.timeoutMs).toBe(12000);
      expect(parsed.agyBinPath).toBe(path.resolve(process.cwd(), '/usr/local/bin/agy'));
    });

    it('parses opencode provider and binary override successfully', () => {
      const parsed = parseArgs([
        '--baseline',
        'BASE-002',
        '--artifact-type',
        'process-diagram',
        '--provider',
        'opencode',
        '--opencode-bin',
        '/opt/bin/opencode'
      ]);

      expect(parsed.provider).toBe('opencode');
      expect(parsed.opencodeBinPath).toBe(path.resolve(process.cwd(), '/opt/bin/opencode'));
    });

    it('parses --model option for agy provider', () => {
      const parsed = parseArgs([
        '--baseline',
        'BASE-001',
        '--artifact-type',
        'process-diagram',
        '--provider',
        'agy',
        '--model',
        'gemini-3.1-pro-high'
      ]);

      expect(parsed.provider).toBe('agy');
      expect(parsed.modelName).toBe('gemini-3.1-pro-high');
    });

    it('parses --model option for opencode provider', () => {
      const parsed = parseArgs([
        '--baseline',
        'BASE-001',
        '--artifact-type',
        'process-diagram',
        '--provider',
        'opencode',
        '--model',
        'minimax-coding-plan/MiniMax-M3'
      ]);

      expect(parsed.provider).toBe('opencode');
      expect(parsed.modelName).toBe('minimax-coding-plan/MiniMax-M3');
    });

    it('rejects unknown options', () => {
      expect(() =>
        parseArgs([
          '--baseline',
          'B1',
          '--artifact-type',
          'process-diagram',
          '--unknown-flag',
          'value'
        ])
      ).toThrow(/Unknown option: '--unknown-flag'/);
    });

    it('rejects positional arguments', () => {
      expect(() =>
        parseArgs(['unexpected-arg', '--baseline', 'B1', '--artifact-type', 'process-diagram'])
      ).toThrow(/Unexpected positional argument: 'unexpected-arg'/);
    });

    it('rejects missing values at end of arguments', () => {
      expect(() => parseArgs(['--baseline'])).toThrow(/Option '--baseline' requires a value/);
    });

    it('rejects missing values preceding another option flag', () => {
      expect(() => parseArgs(['--baseline', '--artifact-type', 'process-diagram'])).toThrow(
        /Option '--baseline' requires a value/
      );
    });

    it('rejects duplicate options', () => {
      expect(() =>
        parseArgs(['--baseline', 'B1', '--artifact-type', 'process-diagram', '--baseline', 'B2'])
      ).toThrow(/Duplicate option: '--baseline'/);
    });

    it('rejects missing required --baseline option', () => {
      expect(() => parseArgs(['--artifact-type', 'process-diagram'])).toThrow(
        /Option '--baseline' is required/
      );
    });

    it('rejects missing required --artifact-type option', () => {
      expect(() => parseArgs(['--baseline', 'BASE-001'])).toThrow(
        /Option '--artifact-type' is required/
      );
    });

    it('rejects invalid artifact type', () => {
      expect(() =>
        parseArgs(['--baseline', 'BASE-001', '--artifact-type', 'unsupported-diagram'])
      ).toThrow(/Invalid artifact type 'unsupported-diagram'/);
    });

    it('rejects invalid provider', () => {
      expect(() =>
        parseArgs([
          '--baseline',
          'BASE-001',
          '--artifact-type',
          'process-diagram',
          '--provider',
          'unsupported-provider'
        ])
      ).toThrow(/Invalid provider 'unsupported-provider'/);
    });

    it('rejects fake provider on the CLI', () => {
      expect(() =>
        parseArgs([
          '--baseline',
          'BASE-001',
          '--artifact-type',
          'process-diagram',
          '--provider',
          'fake'
        ])
      ).toThrow(/Invalid provider 'fake'/);
    });

    it('rejects fake provider configured via GENERATION_PROVIDER env var when not specified on CLI', () => {
      const orig = process.env.GENERATION_PROVIDER;
      try {
        process.env.GENERATION_PROVIDER = 'fake';
        expect(() =>
          parseArgs(['--baseline', 'BASE-001', '--artifact-type', 'process-diagram'])
        ).toThrow(/Invalid provider 'fake'/);
      } finally {
        if (orig !== undefined) {
          process.env.GENERATION_PROVIDER = orig;
        } else {
          delete process.env.GENERATION_PROVIDER;
        }
      }
    });

    it('rejects provider-specific options when provider mismatches', () => {
      expect(() =>
        parseArgs([
          '--baseline',
          'BASE-001',
          '--artifact-type',
          'process-diagram',
          '--provider',
          'opencode',
          '--agy-bin',
          '/usr/bin/agy'
        ])
      ).toThrow(/Option '--agy-bin' is only valid when provider is 'agy'/);

      expect(() =>
        parseArgs([
          '--baseline',
          'BASE-001',
          '--artifact-type',
          'process-diagram',
          '--provider',
          'agy',
          '--opencode-bin',
          '/usr/bin/opencode'
        ])
      ).toThrow(/Option '--opencode-bin' is only valid when provider is 'opencode'/);
    });

    it('rejects non-integer, zero, or negative timeout values', () => {
      expect(() =>
        parseArgs(['--baseline', 'B1', '--artifact-type', 'process-diagram', '--timeout', '0'])
      ).toThrow(/must be a positive integer/);

      expect(() =>
        parseArgs(['--baseline', 'B1', '--artifact-type', 'process-diagram', '--timeout', '-250'])
      ).toThrow(/must be a positive integer/);

      expect(() =>
        parseArgs([
          '--baseline',
          'B1',
          '--artifact-type',
          'process-diagram',
          '--timeout',
          'not-a-number'
        ])
      ).toThrow(/must be a positive integer/);

      expect(() =>
        parseArgs(['--baseline', 'B1', '--artifact-type', 'process-diagram', '--timeout', '12.34'])
      ).toThrow(/must be a positive integer/);
    });
  });

  describe('Production composition contracts', () => {
    it('composes real MermaidCliLinterAdapter and AntigravityCliAdapter for agy provider', () => {
      const components = composeProjectBaselineComponents({
        baselineId: 'BASE-PROD-001',
        artifactType: 'process-diagram',
        provider: 'agy',
        storeDir: tempDir,
        timeoutMs: 5000,
        agyBinPath: '/usr/local/bin/mock-agy'
      });

      expect(components.linterGateway).toBeInstanceOf(MermaidCliLinterAdapter);
      expect(components.generationGateway).toBeInstanceOf(AntigravityCliAdapter);
      expect(components.repository).toBeInstanceOf(FilesystemRequirementsRepository);
      expect(components.provider).toBe('agy');
      expect(components.storeDir).toBe(tempDir);
    });

    it('composes real MermaidCliLinterAdapter and OpenCodeCliAdapter for opencode provider', () => {
      const components = composeProjectBaselineComponents({
        baselineId: 'BASE-PROD-002',
        artifactType: 'state-diagram',
        provider: 'opencode',
        storeDir: tempDir,
        timeoutMs: 8000,
        opencodeBinPath: '/usr/local/bin/mock-opencode'
      });

      expect(components.linterGateway).toBeInstanceOf(MermaidCliLinterAdapter);
      expect(components.generationGateway).toBeInstanceOf(OpenCodeCliAdapter);
      expect(components.repository).toBeInstanceOf(FilesystemRequirementsRepository);
      expect(components.provider).toBe('opencode');
    });

    it('threads model option to generation adapter for agy provider', () => {
      const components = composeProjectBaselineComponents({
        baselineId: 'BASE-PROD-003',
        artifactType: 'process-diagram',
        provider: 'agy',
        storeDir: tempDir,
        modelName: 'gemini-3.1-pro-high'
      });

      expect(components.generationGateway).toBeInstanceOf(AntigravityCliAdapter);
      expect((components.generationGateway as unknown as { model?: string }).model).toBe(
        'gemini-3.1-pro-high'
      );
    });

    it('threads model option to generation adapter for opencode provider', () => {
      const components = composeProjectBaselineComponents({
        baselineId: 'BASE-PROD-004',
        artifactType: 'state-diagram',
        provider: 'opencode',
        storeDir: tempDir,
        modelName: 'minimax-coding-plan/MiniMax-M3'
      });

      expect(components.generationGateway).toBeInstanceOf(OpenCodeCliAdapter);
      expect((components.generationGateway as unknown as { model?: string }).model).toBe(
        'minimax-coding-plan/MiniMax-M3'
      );
    });
  });

  describe('End-to-end CI-safe execution and persistence reload', () => {
    it('executes projection against seeded baseline with closed-loop repair and verifies persisted record', async () => {
      const repoA = new FilesystemRequirementsRepository({ baseDir: tempDir });

      // Seed requirement revisions
      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-VALVE-001-R1'),
        requirementId: createRequirementId('REQ-VALVE-001'),
        revision: 1,
        statement: 'Emergency valve shuts automatically when line pressure exceeds 900 PSI',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR'
      });
      const rev2 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-VALVE-002-R1'),
        requirementId: createRequirementId('REQ-VALVE-002'),
        revision: 1,
        statement: 'Operator console displays high-pressure alert notification',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR'
      });
      await repoA.saveRequirementRevision(rev1);
      await repoA.saveRequirementRevision(rev2);

      // Seed immutable baseline referencing exact revision IDs
      const baseline = createRequirementsBaseline({
        id: createRequirementsBaselineId('BASE-CANONICAL-TEST-001'),
        requirements: [rev1, rev2],
        createdBy: createReviewerId('LEAD-ARCH-01')
      });
      await repoA.saveRequirementsBaseline(baseline);

      // Setup fake doubles for closed-loop repair (1 invalid -> 1 repaired)
      const fakeGateway = new FakeGenerationGateway();
      const fakeLinter = new FakeMermaidLinterGateway();

      fakeGateway.queueResponse('graph TD\n  Start[Pressure Check] --> ;');
      const validRepaired =
        '```mermaid\ngraph TD\n  Start[Pressure Check] --> Alert[Alert Console]\n  Start --> Shut[Auto Shut Valve]\n```';
      fakeGateway.queueResponse(validRepaired);

      const loggedMessages: string[] = [];
      const result = await runProjectBaseline({
        baselineId: 'BASE-CANONICAL-TEST-001',
        artifactType: 'process-diagram',
        provider: 'fake',
        storeDir: tempDir,
        repository: repoA,
        generationGateway: fakeGateway,
        linterGateway: fakeLinter,
        log: (msg) => loggedMessages.push(msg)
      });

      // Assert result structure
      expect(result.success).toBe(true);
      expect(result.projectionId).toMatch(/^PROJ-/);
      expect(result.baselineId).toBe('BASE-CANONICAL-TEST-001');
      expect(result.artifactType).toBe('process-diagram');
      expect(result.requirementRevisionIds).toEqual([rev1.id, rev2.id]);
      expect(result.repairsNeeded).toBe(1);
      expect(result.attemptCount).toBe(2);
      expect(result.contentHash).toHaveLength(64);
      expect(result.content).toBe(
        'graph TD\n  Start[Pressure Check] --> Alert[Alert Console]\n  Start --> Shut[Auto Shut Valve]'
      );

      // Assert human-readable report formatting
      expect(result.reportText).toContain('Solutions Studio: Baseline Projection Report');
      expect(result.reportText).toContain(`Projection ID:            ${result.projectionId}`);
      expect(result.reportText).toContain(`Baseline ID:              ${result.baselineId}`);
      expect(result.reportText).toContain('Artifact Type:            process-diagram');
      expect(result.reportText).toContain('Repairs Needed:           1');
      expect(result.reportText).toContain('Attempt Count:            2');
      expect(result.reportText).toContain(`Content Hash (SHA-256):   ${result.contentHash}`);
      expect(result.reportText).toContain(`Requirement Revision IDs (2):`);
      expect(result.reportText).toContain(`  - ${rev1.id}`);
      expect(result.reportText).toContain(`  - ${rev2.id}`);
      expect(result.reportText).toContain(`projections/${result.projectionId}.json`);

      expect(loggedMessages).toHaveLength(1);
      expect(loggedMessages[0]).toBe(result.reportText);

      // Simulate process restart: instantiate brand new repository over tempDir
      const repoB = new FilesystemRequirementsRepository({ baseDir: tempDir });
      const reloadedRecord = await repoB.getProjectionRecord(result.projectionId);

      expect(reloadedRecord).toBeDefined();
      expect(reloadedRecord!.id).toBe(result.projectionId);
      expect(reloadedRecord!.baselineId).toBe(result.baselineId);
      expect(reloadedRecord!.requirementRevisionIds).toEqual(result.requirementRevisionIds);
      expect(reloadedRecord!.content).toBe(result.content);
      expect(reloadedRecord!.metadata.configuredExecution.provider).toBe('fake');
      expect(reloadedRecord!.metadata.configuredExecution.artifactType).toBe('process-diagram');
      expect(reloadedRecord!.metadata.measuredVerification.repairsNeeded).toBe(1);
      expect(reloadedRecord!.metadata.measuredVerification.attemptCount).toBe(2);
      expect(reloadedRecord!.metadata.measuredVerification.contentHash).toBe(result.contentHash);
      expect(reloadedRecord!.metadata.declaredProvenance.baselineId).toBe(
        'BASE-CANONICAL-TEST-001'
      );
      expect(reloadedRecord!.metadata.declaredProvenance.requirementRevisionIds).toEqual([
        rev1.id,
        rev2.id
      ]);
    });

    it('fails closed when requested baseline does not exist in store', async () => {
      const repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
      const fakeGateway = new FakeGenerationGateway();
      const fakeLinter = new FakeMermaidLinterGateway();

      await expect(
        runProjectBaseline({
          baselineId: 'NON-EXISTENT-BASE',
          artifactType: 'process-diagram',
          provider: 'fake',
          storeDir: tempDir,
          repository: repo,
          generationGateway: fakeGateway,
          linterGateway: fakeLinter
        })
      ).rejects.toThrow(UnknownRequirementsBaselineError);
    });
  });
});
