import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createRequirementId,
  createRequirementRevisionId,
  createRequirementsBaselineId,
  createPolicyConstraintId,
  createPolicyConstraintRevisionId,
  createEngineeringDecisionId,
  createReviewerId,
  createInstant,
  createRequirementsBaseline,
  createRequirementRevision,
  createPolicyConstraintRevision,
  createEngineeringDecision,
  EmptyBaselineError
} from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeGenerationGateway } from '../fakes/FakeGenerationGateway.js';
import { FakeSqlValidatorGateway } from '../fakes/FakeSqlValidatorGateway.js';
import { GenerateSqlSchemaProjectionUseCase } from '../../src/application/use-cases/GenerateSqlSchemaProjectionUseCase.js';
import {
  UnknownRequirementsBaselineError,
  UnknownEngineeringDecisionError
} from '../../src/application/use-cases/ReconciliationErrors.js';
import {
  UnacceptedEngineeringDecisionError,
  RepairRetryExhaustionError
} from '../../src/application/use-cases/SqlSchemaProjectionErrors.js';

describe('GenerateSqlSchemaProjectionUseCase', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let fakeGateway: FakeGenerationGateway;
  let fakeValidator: FakeSqlValidatorGateway;
  let useCase: GenerateSqlSchemaProjectionUseCase;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sql-proj-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    fakeGateway = new FakeGenerationGateway();
    fakeValidator = new FakeSqlValidatorGateway();
    useCase = new GenerateSqlSchemaProjectionUseCase(fakeGateway, fakeValidator, repo, 'fake');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function createValidSql(
    baselineId: string,
    reqIds: string[],
    options?: { polIds?: string[]; edIds?: string[]; body?: string }
  ): string {
    const lines = [`-- @baseline ${baselineId}`, `-- @requirements ${reqIds.join(', ')}`];
    if (options?.polIds && options.polIds.length > 0) {
      lines.push(`-- @policy-constraints ${options.polIds.join(', ')}`);
    }
    if (options?.edIds && options.edIds.length > 0) {
      lines.push(`-- @engineering-decisions ${options.edIds.join(', ')}`);
    }
    lines.push(
      options?.body ??
        `CREATE TABLE accounts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email TEXT NOT NULL UNIQUE
        );`
    );
    return lines.join('\n');
  }

  it('generates a valid SQL schema projection on first attempt with exact provenance', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'User accounts must be stored with unique email',
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

    const validSql = createValidSql('BASE-001', ['REQ-001-R1']);
    fakeGateway.queueResponse(`\`\`\`sql\n${validSql}\n\`\`\``);

    const result = await useCase.execute({
      baselineId: baseline.id
    });

    expect(result.content).toBe(validSql);
    expect(result.metadata.baselineId).toBe('BASE-001');
    expect(result.metadata.artifactType).toBe('sql-schema');
    expect(result.metadata.requirementRevisionIds).toEqual(['REQ-001-R1']);
    expect(result.metadata.declaredProvenance.baselineId).toBe('BASE-001');
    expect(result.metadata.declaredProvenance.requirementRevisionIds).toEqual(['REQ-001-R1']);
    expect(result.metadata.measuredVerification.repairsNeeded).toBe(0);
    expect(result.metadata.measuredVerification.attemptCount).toBe(1);
    expect(result.metadata.measuredVerification.contentHash).toBeDefined();

    // Verify persistence in repository
    const saved = await repo.getProjectionRecord(result.projectionId);
    expect(saved).toBeDefined();
    expect(saved?.baselineId).toBe('BASE-001');
    expect(saved?.artifactType).toBe('sql-schema');
    expect(saved?.content).toBe(validSql);
    expect(saved?.metadata.declaredProvenance.requirementRevisionIds).toEqual(['REQ-001-R1']);
  });

  it('performs closed-loop repair when SQL execution validator returns an error', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Store orders with total amount',
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

    const invalidSql = createValidSql('BASE-002', ['REQ-001-R1'], {
      body: 'CREAT TABL broken_syntax (id INT);'
    });
    const repairedSql = createValidSql('BASE-002', ['REQ-001-R1'], {
      body: 'CREATE TABLE orders (id SERIAL PRIMARY KEY, amount NUMERIC(10, 2));'
    });

    fakeGateway.queueResponse(invalidSql);
    fakeGateway.queueResponse(repairedSql);

    fakeValidator.failNextNTimes(1, 'syntax error at or near "CREAT"');

    const result = await useCase.execute({
      baselineId: baseline.id
    });

    expect(result.content).toBe(repairedSql);
    expect(result.metadata.measuredVerification.repairsNeeded).toBe(1);
    expect(result.metadata.measuredVerification.attemptCount).toBe(2);
    expect(result.repairHistory).toHaveLength(1);
    expect(result.repairHistory[0].errorMessage).toContain('syntax error at or near "CREAT"');
  });

  it('performs closed-loop repair when declared provenance contains invalid revision IDs', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Store orders',
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

    // Initial output claims REQ-001-R1 and an unapproved REQ-999-R1
    const invalidProvSql = createValidSql('BASE-003', ['REQ-001-R1', 'REQ-999-R1']);
    // Corrected output declares only REQ-001-R1
    const repairedSql = createValidSql('BASE-003', ['REQ-001-R1']);

    fakeGateway.queueResponse(invalidProvSql);
    fakeGateway.queueResponse(repairedSql);

    const result = await useCase.execute({
      baselineId: baseline.id
    });

    expect(result.content).toBe(repairedSql);
    expect(result.metadata.measuredVerification.repairsNeeded).toBe(1);
    expect(result.metadata.declaredProvenance.requirementRevisionIds).toEqual(['REQ-001-R1']);
  });

  it('exhausts repair attempts and throws RepairRetryExhaustionError when SQL remains invalid', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Store accounts',
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

    const brokenSql = createValidSql('BASE-004', ['REQ-001-R1'], {
      body: 'CREAT TABL broken_attempt;'
    });

    fakeGateway.queueResponse(brokenSql);
    fakeGateway.queueResponse(brokenSql);
    fakeGateway.queueResponse(brokenSql);

    fakeValidator.failNextNTimes(5, 'Persistent syntax error');

    await expect(
      useCase.execute({
        baselineId: baseline.id,
        options: { maxRepairAttempts: 2 }
      })
    ).rejects.toThrow(RepairRetryExhaustionError);
  });

  it('enforces conditional invariants on policy constraints header (Finding 3)', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Store payment transactions',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const pol1 = createPolicyConstraintRevision({
      id: createPolicyConstraintRevisionId('POL-SEC-001-R1'),
      policyConstraintId: createPolicyConstraintId('POL-SEC-001'),
      revision: 1,
      statement: 'Audit columns created_at and updated_at are mandatory on all tables',
      authorityReference: 'SEC-STANDARD-2026',
      state: 'ACCEPTED',
      createdBy: 'CHIEF-INFOSEC'
    });
    await repo.savePolicyConstraintRevision(pol1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-POL-001'),
      requirements: [rev1],
      policyConstraints: [pol1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    // Attempt 0: Missing @policy-constraints header -> fails provenance
    const missingPolSql = createValidSql('BASE-POL-001', ['REQ-001-R1']);
    // Attempt 1: Includes @policy-constraints header -> passes
    const validPolSql = createValidSql('BASE-POL-001', ['REQ-001-R1'], {
      polIds: ['POL-SEC-001-R1']
    });

    fakeGateway.queueResponse(missingPolSql);
    fakeGateway.queueResponse(validPolSql);

    const result = await useCase.execute({
      baselineId: baseline.id
    });

    expect(result.content).toBe(validPolSql);
    expect(result.metadata.policyConstraintRevisionIds).toEqual(['POL-SEC-001-R1']);
    expect(result.metadata.declaredProvenance.policyConstraintRevisionIds).toEqual([
      'POL-SEC-001-R1'
    ]);
    expect(result.metadata.measuredVerification.repairsNeeded).toBe(1);
  });

  it('fails closed when explicitly passed unaccepted engineering decision ID (Finding 4)', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Store users',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-ED-001'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    // Create a PROPOSED decision (not ACCEPTED)
    const proposedDecision = createEngineeringDecision({
      id: createEngineeringDecisionId('ED-INDEX-001'),
      baselineId: baseline.id,
      statement: 'Index users on email',
      rationale: 'Fast lookup',
      state: 'PROPOSED',
      createdBy: 'ENGINEER-1'
    });
    await repo.saveEngineeringDecision(proposedDecision);

    // Explicitly requesting the unaccepted decision throws UnacceptedEngineeringDecisionError
    await expect(
      useCase.execute({
        baselineId: baseline.id,
        engineeringDecisionIds: ['ED-INDEX-001']
      })
    ).rejects.toThrow(UnacceptedEngineeringDecisionError);

    // Requesting a non-existent decision throws UnknownEngineeringDecisionError
    await expect(
      useCase.execute({
        baselineId: baseline.id,
        engineeringDecisionIds: ['ED-NON-EXISTENT']
      })
    ).rejects.toThrow(UnknownEngineeringDecisionError);
  });

  it('consumes accepted engineering decisions and includes them in prompt and provenance', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Store users',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-ED-002'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    const acceptedDecision = createEngineeringDecision({
      id: createEngineeringDecisionId('ED-KEY-001'),
      baselineId: baseline.id,
      statement: 'Use UUID primary keys',
      rationale: 'Prevent sequential ID harvesting',
      state: 'ACCEPTED',
      createdBy: 'ARCH-1',
      acceptedBy: createReviewerId('REV-LEAD'),
      acceptedAt: createInstant('2026-09-18T12:00:00.000Z')
    });
    await repo.saveEngineeringDecision(acceptedDecision);

    const validSql = createValidSql('BASE-ED-002', ['REQ-001-R1'], {
      edIds: ['ED-KEY-001']
    });
    fakeGateway.queueResponse(validSql);

    const result = await useCase.execute({
      baselineId: baseline.id,
      engineeringDecisionIds: ['ED-KEY-001']
    });

    expect(result.content).toBe(validSql);
    expect(result.metadata.engineeringDecisionIds).toEqual(['ED-KEY-001']);
    expect(result.metadata.declaredProvenance.engineeringDecisionIds).toEqual(['ED-KEY-001']);

    // Check that prompt included accepted engineering decision
    expect(fakeGateway.recordedRequests[0].prompt).toContain('Accepted Engineering Decisions:');
    expect(fakeGateway.recordedRequests[0].prompt).toContain('ED-KEY-001');
  });

  it('extracts proposed engineering decisions and candidate findings with lineage-blocking revisions (Finding 1)', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-AUTH-001-R1'),
      requirementId: createRequirementId('REQ-AUTH-001'),
      revision: 1,
      statement: 'Users log in with email and password',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-DISC-001'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    const sqlWithDiscoveries = [
      `-- @baseline BASE-DISC-001`,
      `-- @requirements REQ-AUTH-001-R1`,
      `-- @decision: B-tree index on lower(email) | Case-insensitive lookup optimization`,
      `-- @finding: undefined-cardinality | Unclear whether multiple active sessions per user are permitted`,
      `CREATE TABLE users (`,
      `  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),`,
      `  email TEXT NOT NULL UNIQUE`,
      `);`,
      `CREATE INDEX idx_users_lower_email ON users (lower(email));`
    ].join('\n');

    fakeGateway.queueResponse(sqlWithDiscoveries);

    const result = await useCase.execute({
      baselineId: baseline.id
    });

    // 1. Proposed engineering decision is extracted and saved as PROPOSED
    expect(result.proposedEngineeringDecisions).toHaveLength(1);
    const decision = result.proposedEngineeringDecisions![0];
    expect(decision.statement).toBe('B-tree index on lower(email)');
    expect(decision.rationale).toBe('Case-insensitive lookup optimization');
    expect(decision.state).toBe('PROPOSED');
    expect(decision.baselineId).toBe(baseline.id);

    const savedDecision = await repo.getEngineeringDecision(decision.id);
    expect(savedDecision).toBeDefined();
    expect(savedDecision?.state).toBe('PROPOSED');

    // 2. Candidate finding is extracted and saved with affectedRequirementRevisions defaulting to all baseline requirements
    expect(result.candidateFindings).toHaveLength(1);
    const finding = result.candidateFindings![0];
    expect(finding.type).toBe('undefined-cardinality');
    expect(finding.rationale).toBe(
      'Unclear whether multiple active sessions per user are permitted'
    );
    expect(finding.disposition).toBe('OPEN');
    expect(finding.discoveredBy).toBe('artifact-validation');
    expect(finding.baselineId).toBe(baseline.id);
    expect(finding.affectedRequirementRevisions).toEqual(['REQ-AUTH-001-R1']);

    const savedFinding = await repo.getCandidateFinding(finding.id);
    expect(savedFinding).toBeDefined();
    expect(savedFinding?.disposition).toBe('OPEN');
    expect(savedFinding?.affectedRequirementRevisions).toEqual(['REQ-AUTH-001-R1']);
  });

  it('throws UnknownRequirementsBaselineError when baseline does not exist', async () => {
    await expect(
      useCase.execute({
        baselineId: 'NON-EXISTENT-BASE'
      })
    ).rejects.toThrow(UnknownRequirementsBaselineError);
  });

  it('throws EmptyBaselineError when baseline has no requirements', async () => {
    const emptyBaseline = {
      id: createRequirementsBaselineId('EMPTY-BASE'),
      requirementRevisions: [],
      policyConstraintRevisions: [],
      createdBy: createReviewerId('REV-LEAD'),
      createdAt: createInstant('2026-09-18T12:00:00.000Z')
    };
    await repo.saveRequirementsBaseline(emptyBaseline);

    await expect(
      useCase.execute({
        baselineId: emptyBaseline.id
      })
    ).rejects.toThrow(EmptyBaselineError);
  });
});
