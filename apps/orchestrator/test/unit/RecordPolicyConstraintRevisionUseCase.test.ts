import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DomainError } from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { RecordPolicyConstraintRevisionUseCase } from '../../src/application/use-cases/RecordPolicyConstraintRevisionUseCase.js';
import { GetPolicyConstraintRevisionUseCase } from '../../src/application/use-cases/GetPolicyConstraintRevisionUseCase.js';
import {
  StaleRevisionTargetError,
  UnknownPolicyConstraintRevisionError
} from '../../src/application/use-cases/ReconciliationErrors.js';

describe('Policy Constraint Use Cases', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let recordUseCase: RecordPolicyConstraintRevisionUseCase;
  let getUseCase: GetPolicyConstraintRevisionUseCase;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-usecase-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    recordUseCase = new RecordPolicyConstraintRevisionUseCase(repo);
    getUseCase = new GetPolicyConstraintRevisionUseCase(repo);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('records initial revision for new policy constraint with revision 1', async () => {
    const rev = await recordUseCase.execute({
      policyConstraintId: 'PC-SEC-001',
      statement: 'TLS 1.3 encryption required',
      authorityReference: 'NIST-800-53',
      createdBy: 'sec-lead'
    });

    expect(rev.id).toBe('PC-SEC-001@r1');
    expect(rev.policyConstraintId).toBe('PC-SEC-001');
    expect(rev.revision).toBe(1);
    expect(rev.statement).toBe('TLS 1.3 encryption required');
    expect(rev.authorityReference).toBe('NIST-800-53');
    expect(rev.state).toBe('ACCEPTED');
    expect(rev.supersedes).toBeUndefined();

    // Verify retrievable via GetPolicyConstraintRevisionUseCase
    const fetched = await getUseCase.execute({ revisionId: rev.id });
    expect(fetched.id).toBe(rev.id);
  });

  it('auto-increments revision number and sets supersedes when successor is recorded without explicit supersedes', async () => {
    const rev1 = await recordUseCase.execute({
      policyConstraintId: 'PC-SEC-002',
      statement: 'Initial password policy',
      authorityReference: 'REF-1',
      createdBy: 'admin'
    });
    expect(rev1.revision).toBe(1);

    const rev2 = await recordUseCase.execute({
      policyConstraintId: 'PC-SEC-002',
      statement: 'Updated password policy requiring 16 characters',
      authorityReference: 'REF-2',
      createdBy: 'admin'
    });
    expect(rev2.revision).toBe(2);
    expect(rev2.id).toBe('PC-SEC-002@r2');
    expect(rev2.supersedes).toBe(rev1.id);
  });

  it('validates explicit supersedes lineage and rejects stale or mismatched predecessor', async () => {
    const rev1 = await recordUseCase.execute({
      policyConstraintId: 'PC-SEC-003',
      statement: 'Policy v1',
      authorityReference: 'REF-1',
      createdBy: 'admin'
    });

    const rev2 = await recordUseCase.execute({
      policyConstraintId: 'PC-SEC-003',
      statement: 'Policy v2',
      authorityReference: 'REF-2',
      createdBy: 'admin',
      supersedes: rev1.id
    });
    expect(rev2.revision).toBe(2);
    expect(rev2.supersedes).toBe(rev1.id);

    // Attempting to supersede rev1 now must fail because rev2 is the latest
    await expect(
      recordUseCase.execute({
        policyConstraintId: 'PC-SEC-003',
        statement: 'Policy v2 branch attempt',
        authorityReference: 'REF-3',
        createdBy: 'admin',
        supersedes: rev1.id
      })
    ).rejects.toThrow(StaleRevisionTargetError);
  });

  it('throws UnknownPolicyConstraintRevisionError when explicit supersedes target does not exist', async () => {
    await expect(
      recordUseCase.execute({
        policyConstraintId: 'PC-SEC-004',
        statement: 'Statement',
        authorityReference: 'REF-1',
        createdBy: 'admin',
        supersedes: 'PC-NONEXISTENT@r1'
      })
    ).rejects.toThrow(UnknownPolicyConstraintRevisionError);
  });

  it('rejects empty fields with DomainError', async () => {
    await expect(
      recordUseCase.execute({
        policyConstraintId: '',
        statement: 'Statement',
        authorityReference: 'REF',
        createdBy: 'admin'
      })
    ).rejects.toThrow(DomainError);

    await expect(
      recordUseCase.execute({
        policyConstraintId: 'PC-001',
        statement: '',
        authorityReference: 'REF',
        createdBy: 'admin'
      })
    ).rejects.toThrow(DomainError);
  });

  it('GetPolicyConstraintRevisionUseCase throws UnknownPolicyConstraintRevisionError for non-existent revision', async () => {
    await expect(getUseCase.execute({ revisionId: 'PC-MISSING@r1' })).rejects.toThrow(
      UnknownPolicyConstraintRevisionError
    );
  });
});
