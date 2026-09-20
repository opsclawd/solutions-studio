import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createRequirementId,
  createRequirementRevisionId,
  createPolicyConstraintId,
  createPolicyConstraintRevisionId,
  createRequirementsBaselineId,
  createReviewerId,
  createRequirementRevision,
  createPolicyConstraintRevision,
  createRequirementsBaseline
} from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { GetAuthorityBundleUseCase } from '../../src/application/use-cases/GetAuthorityBundleUseCase.js';
import {
  UnknownRequirementsBaselineError,
  UnknownRequirementRevisionError,
  UnknownPolicyConstraintRevisionError
} from '../../src/application/use-cases/ReconciliationErrors.js';

describe('GetAuthorityBundleUseCase', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let useCase: GetAuthorityBundleUseCase;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'authority-bundle-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    useCase = new GetAuthorityBundleUseCase(repo);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('assembles a frozen AuthorityBundle containing exact baseline, requirements, and policy constraints', async () => {
    const r1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Business requirement 1',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(r1);

    const pc1 = createPolicyConstraintRevision({
      id: createPolicyConstraintRevisionId('PC-SEC-001@r1'),
      policyConstraintId: createPolicyConstraintId('PC-SEC-001'),
      revision: 1,
      statement: 'Policy constraint 1',
      authorityReference: 'NIST-800-53',
      state: 'ACCEPTED',
      createdBy: 'sec-officer'
    });
    await repo.savePolicyConstraintRevision(pc1);

    const baseId = createRequirementsBaselineId('BASE-001');
    const baseline = createRequirementsBaseline({
      id: baseId,
      requirements: [r1],
      policyConstraints: [pc1],
      createdBy: createReviewerId('REV-01')
    });
    await repo.saveRequirementsBaseline(baseline);

    const bundle = await useCase.execute({ baselineId: 'BASE-001' });

    expect(bundle.baseline.id).toBe('BASE-001');
    expect(bundle.requirements).toHaveLength(1);
    expect(bundle.requirements[0].id).toBe('REQ-001-R1');
    expect(bundle.policyConstraints).toHaveLength(1);
    expect(bundle.policyConstraints[0].id).toBe('PC-SEC-001@r1');
    expect(Object.isFrozen(bundle)).toBe(true);
  });

  it('throws UnknownRequirementsBaselineError when baseline does not exist', async () => {
    await expect(useCase.execute({ baselineId: 'BASE-NONEXISTENT' })).rejects.toThrow(
      UnknownRequirementsBaselineError
    );
  });

  it('throws UnknownRequirementRevisionError when referenced requirement revision is missing from store', async () => {
    const baseId = createRequirementsBaselineId('BASE-002');
    const missingReqRevId = createRequirementRevisionId('REQ-MISSING-R1');

    // Bypass repository validation by creating corrupted baseline record
    await repo.saveRequirementsBaseline({
      id: baseId,
      requirementRevisions: [missingReqRevId],
      policyConstraintRevisions: [],
      createdBy: createReviewerId('REV-01'),
      createdAt: '2026-09-18T12:00:00.000Z' as any
    });

    await expect(useCase.execute({ baselineId: 'BASE-002' })).rejects.toThrow(
      UnknownRequirementRevisionError
    );
  });

  it('throws UnknownPolicyConstraintRevisionError when referenced policy constraint is missing from store', async () => {
    const r1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-003-R1'),
      requirementId: createRequirementId('REQ-003'),
      revision: 1,
      statement: 'Statement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(r1);

    const baseId = createRequirementsBaselineId('BASE-003');
    const missingPolRevId = createPolicyConstraintRevisionId('PC-MISSING@r1');

    await repo.saveRequirementsBaseline({
      id: baseId,
      requirementRevisions: [r1.id],
      policyConstraintRevisions: [missingPolRevId],
      createdBy: createReviewerId('REV-01'),
      createdAt: '2026-09-18T12:00:00.000Z' as any
    });

    await expect(useCase.execute({ baselineId: 'BASE-003' })).rejects.toThrow(
      UnknownPolicyConstraintRevisionError
    );
  });
});
