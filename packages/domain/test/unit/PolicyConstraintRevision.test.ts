import { describe, it, expect } from 'vitest';
import {
  createPolicyConstraintId,
  createPolicyConstraintRevisionId,
  createPolicyConstraintRevision,
  revisePolicyConstraint,
  DomainError,
  InvalidRevisionNumberError
} from '../../src/index.js';

describe('PolicyConstraintRevision', () => {
  it('creates an immutable policy constraint revision with auto-generated ID and default ACCEPTED state', () => {
    const pcId = createPolicyConstraintId('PC-SEC-001');
    const rev = createPolicyConstraintRevision({
      policyConstraintId: pcId,
      revision: 1,
      statement: 'All network traffic must be encrypted in transit via TLS 1.3.',
      authorityReference: 'NIST-800-53/SC-8',
      createdBy: 'sec-architect'
    });

    expect(rev.id).toBe('PC-SEC-001@r1');
    expect(rev.policyConstraintId).toBe('PC-SEC-001');
    expect(rev.revision).toBe(1);
    expect(rev.statement).toBe('All network traffic must be encrypted in transit via TLS 1.3.');
    expect(rev.authorityReference).toBe('NIST-800-53/SC-8');
    expect(rev.state).toBe('ACCEPTED');
    expect(rev.createdBy).toBe('sec-architect');
    expect(rev.supersedes).toBeUndefined();
    expect(Object.isFrozen(rev)).toBe(true);
  });

  it('allows explicit ID, state, and supersedes', () => {
    const pcId = createPolicyConstraintId('PC-SEC-001');
    const customId = createPolicyConstraintRevisionId('CUSTOM-REV-ID');
    const supersedesId = createPolicyConstraintRevisionId('PC-SEC-001@r1');

    const rev = createPolicyConstraintRevision({
      id: customId,
      policyConstraintId: pcId,
      revision: 2,
      statement: 'Updated statement',
      authorityReference: 'ISO-27001/A.10.1',
      state: 'PENDING',
      createdBy: 'compliance-officer',
      supersedes: supersedesId
    });

    expect(rev.id).toBe('CUSTOM-REV-ID');
    expect(rev.revision).toBe(2);
    expect(rev.state).toBe('PENDING');
    expect(rev.supersedes).toBe('PC-SEC-001@r1');
  });

  it('rejects invalid revision numbers', () => {
    const pcId = createPolicyConstraintId('PC-SEC-001');

    expect(() =>
      createPolicyConstraintRevision({
        policyConstraintId: pcId,
        revision: 0,
        statement: 'Valid statement',
        authorityReference: 'Auth ref',
        createdBy: 'user'
      })
    ).toThrow(InvalidRevisionNumberError);

    expect(() =>
      createPolicyConstraintRevision({
        policyConstraintId: pcId,
        revision: -1,
        statement: 'Valid statement',
        authorityReference: 'Auth ref',
        createdBy: 'user'
      })
    ).toThrow(InvalidRevisionNumberError);

    expect(() =>
      createPolicyConstraintRevision({
        policyConstraintId: pcId,
        revision: 1.5,
        statement: 'Valid statement',
        authorityReference: 'Auth ref',
        createdBy: 'user'
      })
    ).toThrow(InvalidRevisionNumberError);
  });

  it('rejects empty statement, authorityReference, or createdBy', () => {
    const pcId = createPolicyConstraintId('PC-SEC-001');

    expect(() =>
      createPolicyConstraintRevision({
        policyConstraintId: pcId,
        revision: 1,
        statement: '',
        authorityReference: 'Auth ref',
        createdBy: 'user'
      })
    ).toThrow(DomainError);

    expect(() =>
      createPolicyConstraintRevision({
        policyConstraintId: pcId,
        revision: 1,
        statement: 'Valid statement',
        authorityReference: '  ',
        createdBy: 'user'
      })
    ).toThrow(DomainError);

    expect(() =>
      createPolicyConstraintRevision({
        policyConstraintId: pcId,
        revision: 1,
        statement: 'Valid statement',
        authorityReference: 'Auth ref',
        createdBy: ''
      })
    ).toThrow(DomainError);
  });

  it('rejects invalid state values', () => {
    const pcId = createPolicyConstraintId('PC-SEC-001');

    expect(() =>
      createPolicyConstraintRevision({
        policyConstraintId: pcId,
        revision: 1,
        statement: 'Valid statement',
        authorityReference: 'Auth ref',
        state: 'UNKNOWN' as any,
        createdBy: 'user'
      })
    ).toThrow(DomainError);
  });

  it('revisePolicyConstraint increments revision, sets supersedes, and freezes new revision', () => {
    const pcId = createPolicyConstraintId('PC-SEC-001');
    const r1 = createPolicyConstraintRevision({
      policyConstraintId: pcId,
      revision: 1,
      statement: 'Initial rule',
      authorityReference: 'Policy v1',
      createdBy: 'architect-1'
    });

    const r2 = revisePolicyConstraint(r1, {
      statement: 'Revised rule with stronger encryption',
      createdBy: 'architect-2'
    });

    expect(r2.id).toBe('PC-SEC-001@r2');
    expect(r2.revision).toBe(2);
    expect(r2.statement).toBe('Revised rule with stronger encryption');
    expect(r2.authorityReference).toBe('Policy v1'); // preserved
    expect(r2.supersedes).toBe(r1.id);
    expect(r2.createdBy).toBe('architect-2');
    expect(Object.isFrozen(r2)).toBe(true);
  });
});
