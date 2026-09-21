import { createAuthenticatedActor, type AuthenticatedActor } from '@solutions-studio/domain';
import {
  AuthenticationError,
  type IAuthenticator,
  type IdentityHealthReport
} from '../../application/ports/identity/index.js';

export interface TestAuthenticatorOptions {
  readonly allowAnonymousFallback?: boolean;
  readonly defaultActor?: AuthenticatedActor;
}

export const DEFAULT_TEST_ACTOR: AuthenticatedActor = createAuthenticatedActor({
  id: 'lead-reviewer',
  name: 'Default Lead Reviewer',
  email: 'reviewer@solutions-studio.test',
  actorType: 'human',
  capabilities: [
    'requirements:reconcile',
    'candidate:approve',
    'baseline:create',
    'engineering-decision:author',
    'engineering-decision:approve',
    'policy-constraint:author',
    'projection:generate',
    'backlog:export'
  ],
  metadata: {
    isAnonymousFallback: true
  }
});

export const TEST_PERSONAS: Record<string, AuthenticatedActor> = {
  reviewer: createAuthenticatedActor({
    id: 'lead-reviewer',
    name: 'Alice Reviewer',
    email: 'alice@example.com',
    actorType: 'human',
    capabilities: ['requirements:reconcile', 'candidate:approve', 'baseline:create']
  }),
  architect: createAuthenticatedActor({
    id: 'lead-architect',
    name: 'Bob Architect',
    email: 'bob@example.com',
    actorType: 'human',
    capabilities: [
      'engineering-decision:approve',
      'engineering-decision:author',
      'baseline:create',
      'policy-constraint:author'
    ]
  }),
  admin: createAuthenticatedActor({
    id: 'lead-admin',
    name: 'Carol Admin',
    email: 'carol@example.com',
    actorType: 'human',
    capabilities: ['operator:admin']
  }),
  exporter: createAuthenticatedActor({
    id: 'delivery-lead',
    name: 'Eve Exporter',
    email: 'eve@example.com',
    actorType: 'human',
    capabilities: ['backlog:export']
  }),
  viewer: createAuthenticatedActor({
    id: 'lead-viewer',
    name: 'Dave Viewer',
    email: 'dave@example.com',
    actorType: 'human',
    capabilities: []
  }),
  agent: createAuthenticatedActor({
    id: 'agent-smith',
    name: 'Agent Smith',
    actorType: 'agent',
    capabilities: ['projection:generate']
  })
};

export class TestAuthenticator implements IAuthenticator {
  private readonly allowAnonymousFallback: boolean;
  private readonly defaultActor: AuthenticatedActor;

  constructor(options: TestAuthenticatorOptions = {}) {
    this.allowAnonymousFallback = options.allowAnonymousFallback ?? true;
    this.defaultActor = options.defaultActor ?? DEFAULT_TEST_ACTOR;
  }

  async authenticate(token?: string): Promise<AuthenticatedActor> {
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      if (this.allowAnonymousFallback) {
        return this.defaultActor;
      }
      throw new AuthenticationError('Missing authentication token', {
        reason: 'UNAUTHENTICATED'
      });
    }

    const cleanToken = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();

    if (cleanToken === 'test:reviewer' || cleanToken === 'token-alice') {
      return TEST_PERSONAS.reviewer;
    }
    if (cleanToken === 'test:architect' || cleanToken === 'token-bob') {
      return TEST_PERSONAS.architect;
    }
    if (cleanToken === 'test:admin' || cleanToken === 'token-carol') {
      return TEST_PERSONAS.admin;
    }
    if (cleanToken === 'test:exporter' || cleanToken === 'token-delivery-lead') {
      return TEST_PERSONAS.exporter;
    }
    if (cleanToken === 'test:viewer' || cleanToken === 'token-dave') {
      return TEST_PERSONAS.viewer;
    }
    if (cleanToken === 'test:agent' || cleanToken === 'token-agent-smith') {
      return TEST_PERSONAS.agent;
    }

    throw new AuthenticationError(`Invalid or unrecognized test token: '${cleanToken}'`, {
      reason: 'INVALID_TOKEN'
    });
  }

  async checkHealth(): Promise<IdentityHealthReport> {
    return {
      status: 'healthy',
      provider: 'test',
      reachable: true
    };
  }
}
