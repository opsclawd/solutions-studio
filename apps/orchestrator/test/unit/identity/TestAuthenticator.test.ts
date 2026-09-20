import { describe, it, expect } from 'vitest';
import {
  TestAuthenticator,
  DEFAULT_TEST_ACTOR,
  TEST_PERSONAS
} from '../../../src/infrastructure/identity/TestAuthenticator.js';
import { AuthenticationError } from '../../../src/application/ports/identity/IdentityErrors.js';

describe('TestAuthenticator', () => {
  it('returns default actor when token is omitted and anonymous fallback is enabled', async () => {
    const auth = new TestAuthenticator();
    const actor = await auth.authenticate(undefined);
    expect(actor.id).toBe(DEFAULT_TEST_ACTOR.id);
    expect(actor.capabilities.has('requirements:reconcile')).toBe(true);
  });

  it('throws AuthenticationError when token is omitted and anonymous fallback is disabled', async () => {
    const auth = new TestAuthenticator({ allowAnonymousFallback: false });
    await expect(auth.authenticate(undefined)).rejects.toThrow(AuthenticationError);
    await expect(auth.authenticate('')).rejects.toThrow(AuthenticationError);
  });

  it('authenticates synthetic persona: reviewer', async () => {
    const auth = new TestAuthenticator();
    const actor = await auth.authenticate('Bearer test:reviewer');
    expect(actor.id).toBe(TEST_PERSONAS.reviewer.id);
    expect(actor.capabilities.has('requirements:reconcile')).toBe(true);
    expect(actor.capabilities.has('candidate:approve')).toBe(true);
    expect(actor.capabilities.has('engineering-decision:approve')).toBe(false);
  });

  it('authenticates synthetic persona: architect', async () => {
    const auth = new TestAuthenticator();
    const actor = await auth.authenticate('Bearer test:architect');
    expect(actor.id).toBe(TEST_PERSONAS.architect.id);
    expect(actor.capabilities.has('engineering-decision:approve')).toBe(true);
    expect(actor.capabilities.has('requirements:reconcile')).toBe(false);
  });

  it('authenticates synthetic persona: admin', async () => {
    const auth = new TestAuthenticator();
    const actor = await auth.authenticate('test:admin');
    expect(actor.id).toBe(TEST_PERSONAS.admin.id);
    expect(actor.capabilities.has('operator:admin')).toBe(true);
  });

  it('authenticates synthetic persona: viewer with zero approval capabilities', async () => {
    const auth = new TestAuthenticator();
    const actor = await auth.authenticate('Bearer test:viewer');
    expect(actor.id).toBe(TEST_PERSONAS.viewer.id);
    expect(actor.capabilities.size).toBe(0);
  });

  it('authenticates synthetic persona: agent with agent actorType', async () => {
    const auth = new TestAuthenticator();
    const actor = await auth.authenticate('Bearer test:agent');
    expect(actor.actorType).toBe('agent');
    expect(actor.capabilities.has('projection:generate')).toBe(true);
    expect(actor.capabilities.has('requirements:reconcile')).toBe(false);
  });

  it('rejects invalid token string with AuthenticationError', async () => {
    const auth = new TestAuthenticator();
    await expect(auth.authenticate('Bearer invalid-secret-token')).rejects.toThrow(
      AuthenticationError
    );
  });
});
