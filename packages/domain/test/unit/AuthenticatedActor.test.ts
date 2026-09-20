import { describe, it, expect } from 'vitest';
import {
  createAuthenticatedActor,
  hasCapability,
  APPLICATION_CAPABILITIES
} from '../../src/identity/AuthenticatedActor.js';

describe('AuthenticatedActor Domain Entity', () => {
  it('creates an AuthenticatedActor with valid properties', () => {
    const actor = createAuthenticatedActor({
      id: 'alice-reviewer',
      name: 'Alice Reviewer',
      email: 'alice@example.com',
      actorType: 'human',
      capabilities: ['requirements:reconcile', 'candidate:approve']
    });

    expect(actor.id).toBe('alice-reviewer');
    expect(actor.name).toBe('Alice Reviewer');
    expect(actor.email).toBe('alice@example.com');
    expect(actor.actorType).toBe('human');
    expect(actor.capabilities.has('requirements:reconcile')).toBe(true);
    expect(actor.capabilities.has('candidate:approve')).toBe(true);
    expect(actor.capabilities.has('baseline:create')).toBe(false);
  });

  it('rejects invalid or empty name', () => {
    expect(() =>
      createAuthenticatedActor({
        id: 'alice',
        name: '   ',
        actorType: 'human',
        capabilities: []
      })
    ).toThrow('AuthenticatedActor name must be a non-empty string');
  });

  it('rejects invalid actorType', () => {
    expect(() =>
      createAuthenticatedActor({
        id: 'alice',
        name: 'Alice',
        actorType: 'alien' as any,
        capabilities: []
      })
    ).toThrow("Invalid actorType: 'alien'");
  });

  it('rejects invalid capability', () => {
    expect(() =>
      createAuthenticatedActor({
        id: 'alice',
        name: 'Alice',
        actorType: 'human',
        capabilities: ['unknown:capability' as any]
      })
    ).toThrow("Invalid ApplicationCapability: 'unknown:capability'");
  });

  it('evaluates capabilities with hasCapability helper, granting admin all capabilities', () => {
    const reviewer = createAuthenticatedActor({
      id: 'alice',
      name: 'Alice',
      actorType: 'human',
      capabilities: ['requirements:reconcile']
    });

    const admin = createAuthenticatedActor({
      id: 'carol',
      name: 'Carol',
      actorType: 'human',
      capabilities: ['operator:admin']
    });

    expect(hasCapability(reviewer, 'requirements:reconcile')).toBe(true);
    expect(hasCapability(reviewer, 'baseline:create')).toBe(false);

    // operator:admin has all capabilities
    for (const cap of APPLICATION_CAPABILITIES) {
      expect(hasCapability(admin, cap)).toBe(true);
    }
  });

  it('is immutable', () => {
    const actor = createAuthenticatedActor({
      id: 'alice',
      name: 'Alice',
      actorType: 'human',
      capabilities: ['requirements:reconcile']
    });

    expect(() => {
      (actor as any).name = 'Bob';
    }).toThrow();

    expect(() => {
      (actor.capabilities as any).add('baseline:create');
    }).toThrow();
  });
});
