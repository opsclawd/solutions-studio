import { describe, it, expect } from 'vitest';
import {
  createEngineeringDecisionId,
  createRequirementsBaselineId,
  createRequirementRevisionId,
  createPolicyConstraintRevisionId,
  createReviewerId,
  createEngineeringDecision,
  isEngineeringDecisionAuthoritative,
  transitionEngineeringDecision,
  DomainError
} from '../../src/index.js';

describe('EngineeringDecision', () => {
  const baselineId = createRequirementsBaselineId('BASE-001');
  const reqRevId = createRequirementRevisionId('R-100@r1');
  const polRevId = createPolicyConstraintRevisionId('PC-SEC-001@r1');

  it('creates a proposed engineering decision with non-authoritative defaults', () => {
    const decision = createEngineeringDecision({
      id: createEngineeringDecisionId('ED-001'),
      baselineId,
      statement: 'Use PostgreSQL composite B-tree index on (tenant_id, created_at).',
      rationale: 'Optimizes high-throughput audit log pagination queries without table scans.',
      requirementRevisionIds: [reqRevId],
      policyConstraintRevisionIds: [polRevId],
      createdBy: 'lead-dev'
    });

    expect(decision.id).toBe('ED-001');
    expect(decision.baselineId).toBe('BASE-001');
    expect(decision.statement).toBe(
      'Use PostgreSQL composite B-tree index on (tenant_id, created_at).'
    );
    expect(decision.rationale).toBe(
      'Optimizes high-throughput audit log pagination queries without table scans.'
    );
    expect(decision.requirementRevisionIds).toEqual(['R-100@r1']);
    expect(decision.policyConstraintRevisionIds).toEqual(['PC-SEC-001@r1']);
    expect(decision.state).toBe('PROPOSED');
    expect(decision.createdBy).toBe('lead-dev');
    expect(decision.acceptedBy).toBeUndefined();
    expect(decision.acceptedAt).toBeUndefined();
    expect(decision.supersedes).toBeUndefined();
    expect(isEngineeringDecisionAuthoritative(decision)).toBe(false);
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.requirementRevisionIds)).toBe(true);
    expect(Object.isFrozen(decision.policyConstraintRevisionIds)).toBe(true);
  });

  it('rejects instantiating decision as ACCEPTED without acceptedBy and acceptedAt', () => {
    expect(() =>
      createEngineeringDecision({
        id: createEngineeringDecisionId('ED-002'),
        baselineId,
        statement: 'Statement',
        rationale: 'Rationale',
        state: 'ACCEPTED',
        createdBy: 'dev'
      })
    ).toThrow(DomainError);

    expect(() =>
      createEngineeringDecision({
        id: createEngineeringDecisionId('ED-002'),
        baselineId,
        statement: 'Statement',
        rationale: 'Rationale',
        state: 'ACCEPTED',
        acceptedBy: createReviewerId('REV-01'),
        // missing acceptedAt
        createdBy: 'dev'
      })
    ).toThrow(DomainError);
  });

  it('rejects setting acceptedBy/acceptedAt on PROPOSED or REJECTED decisions', () => {
    expect(() =>
      createEngineeringDecision({
        id: createEngineeringDecisionId('ED-003'),
        baselineId,
        statement: 'Statement',
        rationale: 'Rationale',
        state: 'PROPOSED',
        acceptedBy: createReviewerId('REV-01'),
        createdBy: 'dev'
      })
    ).toThrow(DomainError);

    expect(() =>
      createEngineeringDecision({
        id: createEngineeringDecisionId('ED-004'),
        baselineId,
        statement: 'Statement',
        rationale: 'Rationale',
        state: 'REJECTED',
        acceptedBy: createReviewerId('REV-01'),
        createdBy: 'dev'
      })
    ).toThrow(DomainError);
  });

  it('rejects empty statement, rationale, or createdBy', () => {
    expect(() =>
      createEngineeringDecision({
        id: createEngineeringDecisionId('ED-005'),
        baselineId,
        statement: '   ',
        rationale: 'Rationale',
        createdBy: 'dev'
      })
    ).toThrow(DomainError);

    expect(() =>
      createEngineeringDecision({
        id: createEngineeringDecisionId('ED-005'),
        baselineId,
        statement: 'Statement',
        rationale: '',
        createdBy: 'dev'
      })
    ).toThrow(DomainError);

    expect(() =>
      createEngineeringDecision({
        id: createEngineeringDecisionId('ED-005'),
        baselineId,
        statement: 'Statement',
        rationale: 'Rationale',
        createdBy: ''
      })
    ).toThrow(DomainError);
  });

  it('transitions decision to ACCEPTED with authorized reviewer and rationale', () => {
    const decision = createEngineeringDecision({
      id: createEngineeringDecisionId('ED-006'),
      baselineId,
      statement: 'Use optimistic concurrency with version column.',
      rationale: 'Prevents lost updates without distributed locks.',
      createdBy: 'dev-1'
    });

    const accepted = transitionEngineeringDecision(decision, {
      newState: 'ACCEPTED',
      rationale: 'Reviewed and approved by architecture council.',
      actorId: 'REV-LEAD'
    });

    expect(accepted.state).toBe('ACCEPTED');
    expect(accepted.rationale).toBe('Prevents lost updates without distributed locks.');
    expect(accepted.transitionRationale).toBe('Reviewed and approved by architecture council.');
    expect(accepted.acceptedBy).toBe('REV-LEAD');
    expect(accepted.acceptedAt).toBeDefined();
    expect(isEngineeringDecisionAuthoritative(accepted)).toBe(true);
    expect(Object.isFrozen(accepted)).toBe(true);
  });

  it('transitions decision to REJECTED and clears acceptance metadata', () => {
    const decision = createEngineeringDecision({
      id: createEngineeringDecisionId('ED-007'),
      baselineId,
      statement: 'Use pessimistic row locking.',
      rationale: 'Initial proposal',
      createdBy: 'dev-1'
    });

    const accepted = transitionEngineeringDecision(decision, {
      newState: 'ACCEPTED',
      rationale: 'Temporarily approved',
      actorId: 'REV-01'
    });

    const rejected = transitionEngineeringDecision(accepted, {
      newState: 'REJECTED',
      rationale: 'Causes deadlocks under high load',
      actorId: 'REV-02'
    });

    expect(rejected.state).toBe('REJECTED');
    expect(rejected.rationale).toBe('Initial proposal');
    expect(rejected.transitionRationale).toBe('Causes deadlocks under high load');
    expect(rejected.acceptedBy).toBeUndefined();
    expect(rejected.acceptedAt).toBeUndefined();
    expect(isEngineeringDecisionAuthoritative(rejected)).toBe(false);
  });

  it('supports lineage preservation via supersedes', () => {
    const predecessorId = createEngineeringDecisionId('ED-008');
    const successor = createEngineeringDecision({
      id: createEngineeringDecisionId('ED-009'),
      baselineId,
      statement: 'Revised indexing strategy',
      rationale: 'Replaces previous index with partial index',
      createdBy: 'dev-1',
      supersedes: predecessorId
    });

    expect(successor.supersedes).toBe('ED-008');
  });
});
