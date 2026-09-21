import { describe, it, expect } from 'vitest';
import {
  AuthenticatedActorDtoSchema,
  ApplicationCapabilitySchema,
  CreateRequirementsBaselineRequestDtoSchema,
  CreatePolicyConstraintRevisionRequestDtoSchema,
  CreateEngineeringDecisionRequestDtoSchema,
  TransitionEngineeringDecisionRequestDtoSchema
} from '../../src/index.js';

describe('Identity Schemas & Optional Identity in Requests', () => {
  it('validates AuthenticatedActorDtoSchema', () => {
    const valid = {
      id: 'actor-123',
      name: 'Alice',
      email: 'alice@example.com',
      actorType: 'human',
      capabilities: ['requirements:reconcile', 'candidate:approve']
    };

    const parsed = AuthenticatedActorDtoSchema.parse(valid);
    expect(parsed.id).toBe('actor-123');
    expect(parsed.capabilities).toEqual(['requirements:reconcile', 'candidate:approve']);
    expect(ApplicationCapabilitySchema.parse('requirements:reconcile')).toBe(
      'requirements:reconcile'
    );
  });

  it('rejects invalid capability in AuthenticatedActorDtoSchema', () => {
    const invalid = {
      id: 'actor-123',
      name: 'Alice',
      actorType: 'human',
      capabilities: ['invalid:capability']
    };

    expect(() => AuthenticatedActorDtoSchema.parse(invalid)).toThrow();
  });

  it('allows optional createdBy in CreateRequirementsBaselineRequestDtoSchema', () => {
    const withoutCreatedBy = {
      requirementRevisions: ['REQ-001-R1']
    };
    const parsed = CreateRequirementsBaselineRequestDtoSchema.parse(withoutCreatedBy);
    expect(parsed.createdBy).toBeUndefined();

    const withCreatedBy = {
      requirementRevisions: ['REQ-001-R1'],
      createdBy: 'custom-actor'
    };
    expect(CreateRequirementsBaselineRequestDtoSchema.parse(withCreatedBy).createdBy).toBe(
      'custom-actor'
    );
  });

  it('allows optional createdBy in CreatePolicyConstraintRevisionRequestDtoSchema', () => {
    const withoutCreatedBy = {
      policyConstraintId: 'POL-001',
      statement: 'Constraint statement',
      authorityReference: 'REF-001'
    };
    const parsed = CreatePolicyConstraintRevisionRequestDtoSchema.parse(withoutCreatedBy);
    expect(parsed.createdBy).toBeUndefined();
  });

  it('allows optional createdBy in CreateEngineeringDecisionRequestDtoSchema', () => {
    const withoutCreatedBy = {
      baselineId: 'BASE-001',
      statement: 'Decision statement',
      rationale: 'Decision rationale'
    };
    const parsed = CreateEngineeringDecisionRequestDtoSchema.parse(withoutCreatedBy);
    expect(parsed.createdBy).toBeUndefined();
  });

  it('allows optional actorId in TransitionEngineeringDecisionRequestDtoSchema', () => {
    const withoutActorId = {
      newState: 'ACCEPTED',
      rationale: 'Accepted by architect'
    };
    const parsed = TransitionEngineeringDecisionRequestDtoSchema.parse(withoutActorId);
    expect(parsed.actorId).toBeUndefined();
  });
});
