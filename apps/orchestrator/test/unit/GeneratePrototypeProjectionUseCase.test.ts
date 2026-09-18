import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createRequirementId,
  createRequirementRevisionId,
  createRequirementsBaselineId,
  createReviewerId,
  createInstant,
  createRequirementsBaseline,
  createRequirementRevision,
  EmptyBaselineError
} from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeGenerationGateway } from '../fakes/FakeGenerationGateway.js';
import { FakePrototypeValidatorGateway } from '../fakes/FakePrototypeValidatorGateway.js';
import { GeneratePrototypeProjectionUseCase } from '../../src/application/use-cases/GeneratePrototypeProjectionUseCase.js';
import {
  UnknownRequirementsBaselineError,
  UnknownRequirementRevisionError
} from '../../src/application/use-cases/ReconciliationErrors.js';
import {
  PrototypeProvenanceValidationError,
  RepairRetryExhaustionError
} from '../../src/application/use-cases/PrototypeProjectionErrors.js';

describe('GeneratePrototypeProjectionUseCase', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let fakeGateway: FakeGenerationGateway;
  let fakeValidator: FakePrototypeValidatorGateway;
  let useCase: GeneratePrototypeProjectionUseCase;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'proto-proj-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    fakeGateway = new FakeGenerationGateway();
    fakeValidator = new FakePrototypeValidatorGateway();
    useCase = new GeneratePrototypeProjectionUseCase(fakeGateway, fakeValidator, repo, 'fake');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function createValidTsx(baselineId: string, revisionIds: string[]): string {
    return [
      '/**',
      ` * @baseline ${baselineId}`,
      ` * @requirements ${revisionIds.join(', ')}`,
      ' */',
      "import React, { useState } from 'react';",
      '',
      'export default function PrototypeComponent() {',
      '  const [status, setStatus] = useState("IDLE");',
      '  return (',
      '    <div className="p-4 bg-white rounded shadow">',
      '      <h1 className="text-base font-bold">Prototype UI</h1>',
      '      <p>Status: {status}</p>',
      '      <button onClick={() => setStatus("ACTIVE")} className="px-3 py-1 bg-blue-600 text-white rounded">',
      '        Activate',
      '      </button>',
      '    </div>',
      '  );',
      '}'
    ].join('\n');
  }

  it('generates a valid prototype from baseline and persists projection metadata', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'System must display active status indicator',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-001'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD'),
      createdAt: createInstant('2026-09-18T12:00:00.000Z')
    });
    await repo.saveRequirementsBaseline(baseline);

    const validCode = createValidTsx('BASE-001', ['REQ-001-R1']);
    fakeGateway.queueResponse(`\`\`\`tsx\n${validCode}\n\`\`\``);

    const result = await useCase.execute({
      baselineId: baseline.id
    });

    expect(result.content).toBe(validCode);
    expect(result.metadata.baselineId).toBe('BASE-001');
    expect(result.metadata.artifactType).toBe('prototype');
    expect(result.metadata.requirementRevisionIds).toEqual(['REQ-001-R1']);
    expect(result.metadata.declaredProvenance.baselineId).toBe('BASE-001');
    expect(result.metadata.declaredProvenance.requirementRevisionIds).toEqual(['REQ-001-R1']);
    expect(result.metadata.measuredVerification.repairsNeeded).toBe(0);
    expect(result.metadata.measuredVerification.attemptCount).toBe(1);
    expect(result.metadata.measuredVerification.contentHash).toBeDefined();

    // Verify repository persistence
    const saved = await repo.getProjectionRecord(result.projectionId);
    expect(saved).toBeDefined();
    expect(saved?.baselineId).toBe('BASE-001');
    expect(saved?.artifactType).toBe('prototype');
    expect(saved?.content).toBe(validCode);
    expect(saved?.metadata.declaredProvenance.requirementRevisionIds).toEqual(['REQ-001-R1']);
  });

  it('rejects declared requirement IDs outside the baseline and repairs them successfully', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Allow users to submit transactions',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-002'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    // First attempt claims REQ-001-R1 and an unapproved revision REQ-999-R1
    const invalidProvenanceCode = createValidTsx('BASE-002', ['REQ-001-R1', 'REQ-999-R1']);
    // Second attempt fixes provenance to only allowed revisions
    const repairedCode = createValidTsx('BASE-002', ['REQ-001-R1']);

    fakeGateway.queueResponse(invalidProvenanceCode);
    fakeGateway.queueResponse(repairedCode);

    const result = await useCase.execute({
      baselineId: baseline.id
    });

    expect(result.content).toBe(repairedCode);
    expect(result.metadata.measuredVerification.repairsNeeded).toBe(1);
    expect(result.metadata.measuredVerification.attemptCount).toBe(2);
    expect(result.repairHistory[0].errorMessage).toContain(
      "Declared requirement revision ID(s) [REQ-999-R1] are not members of baseline 'BASE-002'"
    );

    // Verify repair prompt communicated the baseline membership violation
    expect(fakeGateway.recordedRequests.length).toBe(2);
    const repairPrompt = fakeGateway.recordedRequests[1].prompt;
    expect(repairPrompt).toContain('REQ-999-R1');
    expect(repairPrompt).toContain("are not members of baseline 'BASE-002'");
  });

  it('throws RepairRetryExhaustionError when invalid declared requirement IDs persist through max attempts', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Allowed revision',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-003'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    const hallucinatedCode = createValidTsx('BASE-003', ['REQ-HALLUCINATED-R1']);
    fakeGateway.setDefaultResponse(hallucinatedCode);

    await expect(
      useCase.execute({
        baselineId: baseline.id,
        options: { maxRepairAttempts: 2 }
      })
    ).rejects.toThrow(RepairRetryExhaustionError);
  });

  it('triggers repair and succeeds when initial TSX syntax validation fails', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Syntax validation test',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-004'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    const brokenSyntax = [
      '/**',
      ' * @baseline BASE-004',
      ' * @requirements REQ-001-R1',
      ' */',
      'export default function Broken() { return <div><span>Missing close</div>; }'
    ].join('\n');

    const fixedCode = createValidTsx('BASE-004', ['REQ-001-R1']);

    fakeGateway.queueResponse(brokenSyntax);
    fakeGateway.queueResponse(fixedCode);

    fakeValidator.setResultFor(brokenSyntax, {
      isValid: false,
      errorMessage: 'Unterminated JSX contents on line 5'
    });
    fakeValidator.setDefaultResult({ isValid: true });

    const result = await useCase.execute({
      baselineId: baseline.id
    });

    expect(result.content).toBe(fixedCode);
    expect(result.metadata.measuredVerification.repairsNeeded).toBe(1);
    expect(result.repairHistory[0].errorMessage).toContain('Unterminated JSX');
  });

  it('assertValidProvenance throws PrototypeProvenanceValidationError on direct validation failure', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Direct validation',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-DIRECT'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });

    const invalidCode = createValidTsx('BASE-DIRECT', ['REQ-UNKNOWN-R9']);

    expect(() => useCase.assertValidProvenance(invalidCode, baseline)).toThrow(
      PrototypeProvenanceValidationError
    );
  });

  it('rejects unknown baseline with UnknownRequirementsBaselineError', async () => {
    await expect(
      useCase.execute({
        baselineId: 'BASE-NONEXISTENT'
      })
    ).rejects.toThrow(UnknownRequirementsBaselineError);
  });

  it('rejects empty baseline with EmptyBaselineError', async () => {
    const emptyBaseline = {
      id: createRequirementsBaselineId('BASE-EMPTY'),
      requirementRevisions: [] as any[],
      createdAt: createInstant('2026-09-18T12:00:00.000Z'),
      createdBy: createReviewerId('REV-LEAD')
    };
    await repo.saveRequirementsBaseline(emptyBaseline);

    await expect(
      useCase.execute({
        baselineId: 'BASE-EMPTY'
      })
    ).rejects.toThrow(EmptyBaselineError);
  });

  it('rejects missing requirement revision with UnknownRequirementRevisionError', async () => {
    const baseline = {
      id: createRequirementsBaselineId('BASE-MISSING-REV'),
      requirementRevisions: [createRequirementRevisionId('REQ-MISSING-R1')],
      createdAt: createInstant('2026-09-18T12:00:00.000Z'),
      createdBy: createReviewerId('REV-LEAD')
    };
    await repo.saveRequirementsBaseline(baseline);

    await expect(
      useCase.execute({
        baselineId: 'BASE-MISSING-REV'
      })
    ).rejects.toThrow(UnknownRequirementRevisionError);
  });
});
