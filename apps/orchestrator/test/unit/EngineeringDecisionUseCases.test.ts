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
  createRequirementsBaseline,
  DomainError
} from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { RecordEngineeringDecisionUseCase } from '../../src/application/use-cases/RecordEngineeringDecisionUseCase.js';
import { TransitionEngineeringDecisionUseCase } from '../../src/application/use-cases/TransitionEngineeringDecisionUseCase.js';
import { GetEngineeringDecisionsUseCase } from '../../src/application/use-cases/GetEngineeringDecisionsUseCase.js';
import {
  UnknownRequirementsBaselineError,
  UnknownEngineeringDecisionError,
  InvalidEngineeringDecisionStateError
} from '../../src/application/use-cases/ReconciliationErrors.js';

describe('Engineering Decision Use Cases', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let recordUseCase: RecordEngineeringDecisionUseCase;
  let transitionUseCase: TransitionEngineeringDecisionUseCase;
  let getUseCase: GetEngineeringDecisionsUseCase;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'decision-usecase-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    recordUseCase = new RecordEngineeringDecisionUseCase(repo);
    transitionUseCase = new TransitionEngineeringDecisionUseCase(repo);
    getUseCase = new GetEngineeringDecisionsUseCase(repo);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function seedBaseline(baseId = 'BASE-001') {
    const reqRev = createRequirementRevision({
      id: createRequirementRevisionId(`REQ-${baseId}-R1`),
      requirementId: createRequirementId(`REQ-${baseId}`),
      revision: 1,
      statement: 'Business requirement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(reqRev);

    const polRev = createPolicyConstraintRevision({
      id: createPolicyConstraintRevisionId(`PC-${baseId}@r1`),
      policyConstraintId: createPolicyConstraintId(`PC-${baseId}`),
      revision: 1,
      statement: 'Policy constraint',
      authorityReference: 'NIST',
      state: 'ACCEPTED',
      createdBy: 'sec-lead'
    });
    await repo.savePolicyConstraintRevision(polRev);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId(baseId),
      requirements: [reqRev],
      policyConstraints: [polRev],
      createdBy: createReviewerId('REV-01')
    });
    await repo.saveRequirementsBaseline(baseline);

    return { baseline, reqRev, polRev };
  }

  it('records proposed decision linked to baseline and inputs, forcing state to PROPOSED', async () => {
    const { baseline, reqRev, polRev } = await seedBaseline();

    const decision = await recordUseCase.execute({
      baselineId: baseline.id,
      statement: 'Use read-replicas for query workload',
      rationale: 'Scales read throughput without locking master database',
      requirementRevisionIds: [reqRev.id],
      policyConstraintRevisionIds: [polRev.id],
      createdBy: 'cloud-architect'
    });

    expect(decision.id).toMatch(/^ED-/);
    expect(decision.baselineId).toBe('BASE-001');
    expect(decision.state).toBe('PROPOSED');
    expect(decision.statement).toBe('Use read-replicas for query workload');
    expect(decision.requirementRevisionIds).toEqual([reqRev.id]);
    expect(decision.policyConstraintRevisionIds).toEqual([polRev.id]);
    expect(decision.acceptedBy).toBeUndefined();
    expect(decision.acceptedAt).toBeUndefined();

    // Verify retrievable via GetEngineeringDecisionsUseCase
    const fetched = await getUseCase.getById(decision.id);
    expect(fetched.id).toBe(decision.id);
  });

  it('throws UnknownRequirementsBaselineError when baselineId does not exist', async () => {
    await expect(
      recordUseCase.execute({
        baselineId: 'BASE-NONEXISTENT',
        statement: 'Statement',
        rationale: 'Rationale',
        createdBy: 'dev'
      })
    ).rejects.toThrow(UnknownRequirementsBaselineError);
  });

  it('rejects input revision IDs not present in baseline with DomainError', async () => {
    const { baseline } = await seedBaseline();

    await expect(
      recordUseCase.execute({
        baselineId: baseline.id,
        statement: 'Statement',
        rationale: 'Rationale',
        requirementRevisionIds: ['REQ-NOT-IN-BASELINE@r1'],
        createdBy: 'dev'
      })
    ).rejects.toThrow(DomainError);

    await expect(
      recordUseCase.execute({
        baselineId: baseline.id,
        statement: 'Statement',
        rationale: 'Rationale',
        policyConstraintRevisionIds: ['PC-NOT-IN-BASELINE@r1'],
        createdBy: 'dev'
      })
    ).rejects.toThrow(DomainError);
  });

  it('supports supersedes lineage check and rejects non-existent superseded decision', async () => {
    const { baseline } = await seedBaseline();

    await expect(
      recordUseCase.execute({
        baselineId: baseline.id,
        statement: 'Statement',
        rationale: 'Rationale',
        createdBy: 'dev',
        supersedes: 'ED-NONEXISTENT'
      })
    ).rejects.toThrow(UnknownEngineeringDecisionError);

    // Record decision 1
    const d1 = await recordUseCase.execute({
      baselineId: baseline.id,
      statement: 'Statement 1',
      rationale: 'Rationale 1',
      createdBy: 'dev'
    });

    // Record successor decision 2
    const d2 = await recordUseCase.execute({
      baselineId: baseline.id,
      statement: 'Statement 2',
      rationale: 'Rationale 2',
      createdBy: 'dev',
      supersedes: d1.id
    });
    expect(d2.supersedes).toBe(d1.id);
  });

  it('transitions decision to ACCEPTED and updates repository', async () => {
    const { baseline } = await seedBaseline();

    const decision = await recordUseCase.execute({
      baselineId: baseline.id,
      statement: 'Use JSONB column for audit payload',
      rationale: 'Flexibility for dynamic schemas',
      createdBy: 'dev-1'
    });

    const updated = await transitionUseCase.execute({
      decisionId: decision.id,
      newState: 'ACCEPTED',
      rationale: 'Approved by principal engineer',
      actorId: 'REV-LEAD'
    });

    expect(updated.state).toBe('ACCEPTED');
    expect(updated.rationale).toBe('Flexibility for dynamic schemas');
    expect(updated.transitionRationale).toBe('Approved by principal engineer');
    expect(updated.acceptedBy).toBe('REV-LEAD');
    expect(updated.acceptedAt).toBeDefined();

    // Verify persisted
    const loaded = await getUseCase.getById(decision.id);
    expect(loaded.state).toBe('ACCEPTED');
    expect(loaded.rationale).toBe('Flexibility for dynamic schemas');
    expect(loaded.transitionRationale).toBe('Approved by principal engineer');
    expect(loaded.acceptedBy).toBe('REV-LEAD');
  });

  it('lists decisions with baselineId and state filters', async () => {
    const { baseline } = await seedBaseline('BASE-001');
    const b2 = await seedBaseline('BASE-002');

    const d1 = await recordUseCase.execute({
      baselineId: baseline.id,
      statement: 'Decision 1',
      rationale: 'Rationale 1',
      createdBy: 'dev'
    });

    const d2 = await recordUseCase.execute({
      baselineId: b2.baseline.id,
      statement: 'Decision 2',
      rationale: 'Rationale 2',
      createdBy: 'dev'
    });

    await transitionUseCase.execute({
      decisionId: d1.id,
      newState: 'ACCEPTED',
      rationale: 'Accepted',
      actorId: 'REV-01'
    });

    // Filter by baselineId
    const base1Decisions = (await getUseCase.list({ baselineId: 'BASE-001' })) as any[];
    expect(base1Decisions).toHaveLength(1);
    expect(base1Decisions[0].id).toBe(d1.id);

    // Filter by state
    const acceptedDecisions = (await getUseCase.list({ state: 'ACCEPTED' })) as any[];
    expect(acceptedDecisions).toHaveLength(1);
    expect(acceptedDecisions[0].id).toBe(d1.id);

    const proposedDecisions = (await getUseCase.list({ state: 'PROPOSED' })) as any[];
    expect(proposedDecisions).toHaveLength(1);
    expect(proposedDecisions[0].id).toBe(d2.id);
  });

  it('rejects stale concurrent state transition when another reviewer transitions first', async () => {
    const { baseline } = await seedBaseline();

    const decision = await recordUseCase.execute({
      baselineId: baseline.id,
      statement: 'Use read-replicas for search queries',
      rationale: 'Offloads read pressure',
      createdBy: 'dev'
    });

    // Simulate concurrent requests that both read the decision in PROPOSED state
    const [res1, res2] = await Promise.allSettled([
      transitionUseCase.execute({
        decisionId: decision.id,
        newState: 'ACCEPTED',
        rationale: 'Approved by reviewer 1',
        actorId: 'REV-01'
      }),
      transitionUseCase.execute({
        decisionId: decision.id,
        newState: 'REJECTED',
        rationale: 'Rejected by reviewer 2',
        actorId: 'REV-02'
      })
    ]);

    const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
    const rejected = [res1, res2].filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      InvalidEngineeringDecisionStateError
    );

    // Verify final persisted decision matches the winner and was not silently overwritten
    const loaded = await getUseCase.getById(decision.id);
    const winningResult = (fulfilled[0] as PromiseFulfilledResult<any>).value;
    expect(loaded.state).toBe(winningResult.state);
  });
});
