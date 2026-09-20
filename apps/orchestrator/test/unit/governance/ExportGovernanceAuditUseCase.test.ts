import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { FilesystemRequirementsRepository } from '../../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { ExportGovernanceAuditUseCase } from '../../../src/application/use-cases/governance/ExportGovernanceAuditUseCase.js';
import { EvaluateCandidatePromotionStatusUseCase } from '../../../src/application/use-cases/governance/EvaluateCandidatePromotionStatusUseCase.js';
import { ApproveCandidateUseCase } from '../../../src/application/use-cases/governance/ApproveCandidateUseCase.js';
import { RecordValidationRunUseCase } from '../../../src/application/use-cases/governance/RecordValidationRunUseCase.js';
import { DefaultAuthorizationPolicy } from '../../../src/infrastructure/identity/DefaultAuthorizationPolicy.js';
import { createAuthenticatedActor } from '@solutions-studio/domain';

describe('ExportGovernanceAuditUseCase', () => {
  let tmpDir: string;
  let repo: FilesystemRequirementsRepository;
  let authPolicy: DefaultAuthorizationPolicy;
  let exportUseCase: ExportGovernanceAuditUseCase;
  let statusUseCase: EvaluateCandidatePromotionStatusUseCase;
  let approveUseCase: ApproveCandidateUseCase;
  let recordRunUseCase: RecordValidationRunUseCase;
  const candidateSha = 'd5adf81ac2ba5acd7b7cd22c830f03e2258a63b4';

  const humanReviewer = createAuthenticatedActor({
    id: 'ACTOR-HUMAN-01',
    name: 'Alice Reviewer',
    actorType: 'human',
    capabilities: ['candidate:approve']
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'export-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tmpDir });
    authPolicy = new DefaultAuthorizationPolicy();
    statusUseCase = new EvaluateCandidatePromotionStatusUseCase(repo);
    exportUseCase = new ExportGovernanceAuditUseCase(repo, statusUseCase);
    approveUseCase = new ApproveCandidateUseCase(repo, authPolicy);
    recordRunUseCase = new RecordValidationRunUseCase(repo);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('exports structured audit package with tamper-evident manifest checksum', async () => {
    const run = await recordRunUseCase.execute({
      candidateSha,
      phase: 'phase-3',
      executionMode: 'deterministic-ci',
      provider: 'fake',
      artifacts: [
        {
          name: 'schema.sql',
          artifactType: 'sql-ddl',
          contentHash: 'a'.repeat(64)
        }
      ],
      proposedDisposition: 'GO',
      executedBy: 'RUNNER-CI'
    });

    await approveUseCase.execute({
      candidateSha,
      validationRunId: run.id,
      evidenceDigest: run.evidenceDigest,
      decision: 'GO',
      rationale: 'Approved for production',
      actor: humanReviewer
    });

    const exportData = await exportUseCase.execute({ candidateSha });

    expect(exportData.candidateSha).toBe(candidateSha);
    expect(exportData.promotionStatus.isApproved).toBe(true);
    expect(exportData.validationRuns).toHaveLength(1);
    expect(exportData.approvalHistory).toHaveLength(1);
    expect(exportData.manifestChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(exportData.verifiedArtifacts).toBeDefined();

    // Verify checksum validity
    const payload = {
      exportedAt: exportData.exportedAt,
      candidateSha: exportData.candidateSha,
      promotionStatus: exportData.promotionStatus,
      validationRuns: exportData.validationRuns,
      approvalHistory: exportData.approvalHistory,
      verifiedArtifacts: exportData.verifiedArtifacts
    };
    const expectedChecksum = crypto
      .createHash('sha256')
      .update(JSON.stringify(payload), 'utf8')
      .digest('hex');
    expect(exportData.manifestChecksum).toBe(expectedChecksum);
  });
});
