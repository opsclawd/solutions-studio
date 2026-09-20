import { describe, it, expect } from 'vitest';
import {
  createRequirementsBaseline,
  createRequirementsBaselineId,
  createReviewerId,
  createRequirementId,
  createRequirementRevisionId,
  createPolicyConstraintId,
  createPolicyConstraintRevisionId,
  createRequirementRevision,
  createPolicyConstraintRevision,
  createAuthorityBundle,
  DomainError
} from '../../src/index.js';

describe('AuthorityBundle', () => {
  function makeAcceptedReq(reqId: string, revNum: number) {
    return createRequirementRevision({
      id: createRequirementRevisionId(`${reqId}@r${revNum}`),
      requirementId: createRequirementId(reqId),
      revision: revNum,
      statement: `Statement for ${reqId}`,
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
  }

  function makeAcceptedPolicy(pcId: string, revNum: number) {
    return createPolicyConstraintRevision({
      id: createPolicyConstraintRevisionId(`${pcId}@r${revNum}`),
      policyConstraintId: createPolicyConstraintId(pcId),
      revision: revNum,
      statement: `Statement for ${pcId}`,
      authorityReference: 'NIST-800-53',
      state: 'ACCEPTED',
      createdBy: 'sec-lead'
    });
  }

  it('creates an immutable authority bundle with exact matching requirements and policy constraints', () => {
    const r1 = makeAcceptedReq('R-100', 1);
    const r2 = makeAcceptedReq('R-101', 2);
    const p1 = makeAcceptedPolicy('PC-SEC-01', 1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-001'),
      requirements: [r1, r2],
      policyConstraints: [p1],
      createdBy: createReviewerId('REV-01')
    });

    const bundle = createAuthorityBundle({
      baseline,
      requirements: [r1, r2],
      policyConstraints: [p1]
    });

    expect(bundle.baseline.id).toBe('BASE-001');
    expect(bundle.requirements).toHaveLength(2);
    expect(bundle.policyConstraints).toHaveLength(1);
    expect(bundle.requirements[0].id).toBe('R-100@r1');
    expect(bundle.policyConstraints[0].id).toBe('PC-SEC-01@r1');
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.requirements)).toBe(true);
    expect(Object.isFrozen(bundle.policyConstraints)).toBe(true);
  });

  it('rejects bundle when requirements do not match baseline requirement revisions', () => {
    const r1 = makeAcceptedReq('R-100', 1);
    const r2 = makeAcceptedReq('R-101', 2);
    const r3 = makeAcceptedReq('R-102', 1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-001'),
      requirements: [r1, r2],
      createdBy: createReviewerId('REV-01')
    });

    // Case 1: Missing requirement
    expect(() =>
      createAuthorityBundle({
        baseline,
        requirements: [r1]
      })
    ).toThrow(DomainError);

    // Case 2: Extra requirement
    expect(() =>
      createAuthorityBundle({
        baseline,
        requirements: [r1, r2, r3]
      })
    ).toThrow(DomainError);

    // Case 3: Different revision
    const r2DifferentRev = makeAcceptedReq('R-101', 3);
    expect(() =>
      createAuthorityBundle({
        baseline,
        requirements: [r1, r2DifferentRev]
      })
    ).toThrow(DomainError);
  });

  it('rejects bundle when policy constraints do not match baseline policy constraint revisions', () => {
    const r1 = makeAcceptedReq('R-100', 1);
    const p1 = makeAcceptedPolicy('PC-SEC-01', 1);
    const p2 = makeAcceptedPolicy('PC-SEC-02', 1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-001'),
      requirements: [r1],
      policyConstraints: [p1],
      createdBy: createReviewerId('REV-01')
    });

    // Missing policy constraint
    expect(() =>
      createAuthorityBundle({
        baseline,
        requirements: [r1],
        policyConstraints: []
      })
    ).toThrow(DomainError);

    // Extra policy constraint
    expect(() =>
      createAuthorityBundle({
        baseline,
        requirements: [r1],
        policyConstraints: [p1, p2]
      })
    ).toThrow(DomainError);
  });

  it('rejects bundle when a requirement is not ACCEPTED or CLEAR', () => {
    const r1 = makeAcceptedReq('R-100', 1);
    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-001'),
      requirements: [r1],
      createdBy: createReviewerId('REV-01')
    });

    const unacceptedReq = createRequirementRevision({
      id: createRequirementRevisionId('R-100@r1'),
      requirementId: createRequirementId('R-100'),
      revision: 1,
      statement: 'Statement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'PENDING',
      resolutionState: 'CLEAR'
    });

    expect(() =>
      createAuthorityBundle({
        baseline,
        requirements: [unacceptedReq]
      })
    ).toThrow(DomainError);
  });

  it('rejects bundle when a policy constraint is not ACCEPTED', () => {
    const r1 = makeAcceptedReq('R-100', 1);
    const p1 = makeAcceptedPolicy('PC-SEC-01', 1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-001'),
      requirements: [r1],
      policyConstraints: [p1],
      createdBy: createReviewerId('REV-01')
    });

    const unacceptedPolicy = createPolicyConstraintRevision({
      id: createPolicyConstraintRevisionId('PC-SEC-01@r1'),
      policyConstraintId: createPolicyConstraintId('PC-SEC-01'),
      revision: 1,
      statement: 'Statement',
      authorityReference: 'NIST-800-53',
      state: 'REJECTED',
      createdBy: 'sec-lead'
    });

    expect(() =>
      createAuthorityBundle({
        baseline,
        requirements: [r1],
        policyConstraints: [unacceptedPolicy]
      })
    ).toThrow(DomainError);
  });
});
