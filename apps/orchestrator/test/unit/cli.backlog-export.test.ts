import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  parseArgs,
  runBacklogExport,
  formatExportReport
} from '../../scripts/run-backlog-export.js';
import {
  createRequirementsBaselineId,
  createRequirementRevisionId,
  createRequirementId,
  createStoryId,
  createReviewerId,
  createAuthenticatedActor,
  now
} from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeBacklogExportGateway } from '../fakes/FakeBacklogExportGateway.js';
import { RealBacklogMutationForbiddenError } from '../../src/application/ports/backlog/BacklogExportErrors.js';

describe('CLI: run-backlog-export', () => {
  describe('parseArgs', () => {
    it('parses valid CLI flags correctly', () => {
      const parsed = parseArgs([
        '--baseline',
        'BASE-001',
        '--target',
        'acme/project',
        '--provider',
        'github-issues',
        '--story',
        'STORY-1,STORY-2',
        '--force-update',
        '--token',
        'ghp_secret',
        '--base-url',
        'http://127.0.0.1:9999',
        '--allow-real-mutation',
        '--format',
        'json'
      ]);

      expect(parsed.baselineId).toBe('BASE-001');
      expect(parsed.targetContainer).toBe('acme/project');
      expect(parsed.provider).toBe('github-issues');
      expect(parsed.storyIds).toEqual(['STORY-1', 'STORY-2']);
      expect(parsed.forceUpdate).toBe(true);
      expect(parsed.token).toBe('ghp_secret');
      expect(parsed.baseUrl).toBe('http://127.0.0.1:9999');
      expect(parsed.allowRealMutation).toBe(true);
      expect(parsed.format).toBe('json');
    });

    it('throws error when --baseline is missing', () => {
      expect(() => parseArgs(['--target', 'acme/project'])).toThrow(
        'Missing required argument: --baseline'
      );
    });

    it('throws error when --target is missing', () => {
      expect(() => parseArgs(['--baseline', 'BASE-001'])).toThrow(
        'Missing required argument: --target'
      );
    });

    it('throws error when unknown option is provided', () => {
      expect(() =>
        parseArgs(['--baseline', 'BASE-001', '--target', 'acme/project', '--unknown-flag'])
      ).toThrow('Unknown option: --unknown-flag');
    });
  });

  describe('runBacklogExport execution', () => {
    let tempDir: string;
    let repository: FilesystemRequirementsRepository;
    let fakeGateway: FakeBacklogExportGateway;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-export-test-'));
      repository = new FilesystemRequirementsRepository({ baseDir: tempDir });
      fakeGateway = new FakeBacklogExportGateway();
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('fails closed when attempting live mutation without --allow-real-mutation', async () => {
      const baselineId = createRequirementsBaselineId('BASE-MUT-FAIL');
      await repository.saveRequirementsBaseline({
        id: baselineId,
        requirementRevisions: [],
        policyConstraintRevisions: [],
        createdAt: now(),
        createdBy: createReviewerId('REVIEWER-1')
      });

      // Targeting api.github.com without allowRealMutation must throw RealBacklogMutationForbiddenError
      await expect(
        runBacklogExport({
          baselineId,
          targetContainer: 'acme/repo',
          provider: 'github-issues',
          forceUpdate: false,
          allowRealMutation: false,
          baseUrl: 'https://api.github.com',
          repository,
          format: 'text'
        })
      ).rejects.toThrow(RealBacklogMutationForbiddenError);
    });

    it('executes backlog export successfully with injected fake gateway and reports text/json', async () => {
      const baselineId = createRequirementsBaselineId('BASE-CLI-OK');
      const reqRevId = createRequirementRevisionId('REQ-CLI-R1');

      await repository.saveRequirementRevision({
        id: reqRevId,
        requirementId: createRequirementId('REQ-CLI-1'),
        revision: 1,
        statement: 'Core CLI functionality',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR',
        evidence: [],
        rationale: 'CLI test'
      });

      await repository.saveRequirementsBaseline({
        id: baselineId,
        requirementRevisions: [reqRevId],
        policyConstraintRevisions: [],
        createdAt: now(),
        createdBy: createReviewerId('REVIEWER-1')
      });

      const storyId = createStoryId('STORY-CLI-1');
      await repository.saveStory({
        id: storyId,
        baselineId,
        projectionId: 'proj-cli',
        title: 'Story CLI',
        narrative: { role: 'user', feature: 'export', benefit: 'backlog' },
        requirementRevisionIds: [reqRevId],
        scenarios: [
          {
            title: 'CLI scenario',
            requirementRevisionIds: [reqRevId],
            steps: [{ keyword: 'Given', text: 'CLI is ready' }]
          }
        ],
        acceptanceCriteria: ['AC1'],
        gherkinText: 'Feature: Story CLI\nScenario: CLI scenario\nGiven CLI is ready',
        metadata: {
          baselineId,
          requirementRevisionIds: [reqRevId],
          artifactType: 'stories',
          declaredProvenance: { baselineId, requirementRevisionIds: [reqRevId] },
          configuredExecution: { provider: 'fake', artifactType: 'stories' },
          measuredVerification: {
            repairsNeeded: 0,
            attemptCount: 1,
            contentHash: 'h1',
            verifiedAt: now()
          }
        },
        createdAt: now()
      });

      const logs: string[] = [];
      const actor = createAuthenticatedActor({
        id: 'operator-1',
        name: 'CLI Operator',
        actorType: 'human',
        capabilities: ['backlog:export']
      });

      const result = await runBacklogExport({
        baselineId,
        targetContainer: 'acme/repo',
        provider: 'fake',
        forceUpdate: false,
        allowRealMutation: false,
        repository,
        gateway: fakeGateway,
        actor,
        format: 'text',
        log: (msg) => logs.push(msg)
      });

      expect(result.summary.total).toBe(1);
      expect(result.summary.created).toBe(1);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain('Backlog Export Report: Baseline BASE-CLI-OK');
      expect(logs[0]).toContain('[CREATED] Story: STORY-CLI-1');

      // Test formatExportReport formatting
      const report = formatExportReport(result);
      expect(report).toContain('Total: 1 | Created: 1');
    });

    it('rejects deceptive non-loopback hostnames in CLI when allowRealMutation is false', async () => {
      const baselineId = createRequirementsBaselineId('BASE-CLI-DECEPTIVE');
      await repository.saveRequirementsBaseline({
        id: baselineId,
        requirementRevisions: [],
        policyConstraintRevisions: [],
        createdAt: now(),
        createdBy: createReviewerId('REV-1')
      });

      const deceptiveHosts = [
        'http://localhost.attacker.example',
        'http://127.0.0.1.attacker.example',
        'http://user:pass@localhost:8080'
      ];

      for (const baseUrl of deceptiveHosts) {
        await expect(
          runBacklogExport({
            baselineId,
            targetContainer: 'acme/repo',
            provider: 'github-issues',
            forceUpdate: false,
            allowRealMutation: false,
            baseUrl,
            repository,
            format: 'text',
            operatorToken: 'test:exporter',
            allowTestAuthenticator: true
          })
        ).rejects.toThrow(RealBacklogMutationForbiddenError);
      }
    });

    it('requires authenticated operator identity and rejects unauthenticated runs', async () => {
      const baselineId = createRequirementsBaselineId('BASE-CLI-AUTH');
      await repository.saveRequirementsBaseline({
        id: baselineId,
        requirementRevisions: [],
        policyConstraintRevisions: [],
        createdAt: now(),
        createdBy: createReviewerId('REV-1')
      });

      // When neither actor nor token is passed and NODE_ENV is unset/overridden
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        await expect(
          runBacklogExport({
            baselineId,
            targetContainer: 'acme/repo',
            provider: 'fake',
            forceUpdate: false,
            allowRealMutation: false,
            repository,
            gateway: fakeGateway,
            format: 'text'
          })
        ).rejects.toThrow('Authenticated operator identity is required for backlog export');
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('authenticates operator via --operator-token and --allow-test-authenticator', async () => {
      const baselineId = createRequirementsBaselineId('BASE-CLI-TOKEN');
      await repository.saveRequirementsBaseline({
        id: baselineId,
        requirementRevisions: [],
        policyConstraintRevisions: [],
        createdAt: now(),
        createdBy: createReviewerId('REV-1')
      });

      const result = await runBacklogExport({
        baselineId,
        targetContainer: 'acme/repo',
        provider: 'fake',
        forceUpdate: false,
        allowRealMutation: false,
        repository,
        gateway: fakeGateway,
        format: 'text',
        operatorToken: 'test:exporter',
        allowTestAuthenticator: true
      });

      expect(result.summary.total).toBe(0);
    });

    it('rejects provider mismatch between CLI option and injected gateway', async () => {
      const baselineId = createRequirementsBaselineId('BASE-CLI-MISMATCH');
      await repository.saveRequirementsBaseline({
        id: baselineId,
        requirementRevisions: [],
        policyConstraintRevisions: [],
        createdAt: now(),
        createdBy: createReviewerId('REV-1')
      });

      const actor = createAuthenticatedActor({
        id: 'operator-1',
        name: 'CLI Operator',
        actorType: 'human',
        capabilities: ['backlog:export']
      });

      await expect(
        runBacklogExport({
          baselineId,
          targetContainer: 'acme/repo',
          provider: 'jira',
          forceUpdate: false,
          allowRealMutation: false,
          repository,
          gateway: fakeGateway,
          actor,
          format: 'text'
        })
      ).rejects.toThrow("Provider mismatch: CLI specified 'jira' but injected gateway is 'fake'");
    });
  });
});
