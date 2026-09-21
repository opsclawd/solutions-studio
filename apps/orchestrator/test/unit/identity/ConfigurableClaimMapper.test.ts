import { describe, it, expect } from 'vitest';
import { ConfigurableClaimMapper } from '../../../src/infrastructure/identity/ConfigurableClaimMapper.js';

describe('ConfigurableClaimMapper', () => {
  it('maps Keycloak realm roles to application capabilities for a human user', () => {
    const mapper = new ConfigurableClaimMapper();
    const actor = mapper.mapClaimsToActor({
      sub: 'usr-123',
      iss: 'http://localhost:8080/realms/solutions-studio',
      aud: 'solutions-studio-api',
      exp: Math.floor(Date.now() / 1000) + 3600,
      preferred_username: 'alice.reviewer',
      name: 'Alice Reviewer',
      email: 'alice@example.com',
      realm_access: {
        roles: ['requirements-reviewer', 'default-roles-solutions-studio']
      }
    });

    expect(actor.id).toBe('alice.reviewer');
    expect(actor.name).toBe('Alice Reviewer');
    expect(actor.email).toBe('alice@example.com');
    expect(actor.actorType).toBe('human');
    expect(actor.capabilities.has('requirements:reconcile')).toBe(true);
    expect(actor.capabilities.has('candidate:approve')).toBe(true);
    expect(actor.capabilities.has('engineering-decision:approve')).toBe(false);
  });

  it('maps Keycloak client roles when clientId is configured', () => {
    const mapper = new ConfigurableClaimMapper({ clientId: 'solutions-studio-api' });
    const actor = mapper.mapClaimsToActor({
      sub: 'usr-456',
      iss: 'http://localhost:8080/realms/solutions-studio',
      aud: 'solutions-studio-api',
      exp: Math.floor(Date.now() / 1000) + 3600,
      preferred_username: 'bob.architect',
      name: 'Bob Architect',
      resource_access: {
        'solutions-studio-api': {
          roles: ['lead-architect']
        }
      }
    });

    expect(actor.id).toBe('bob.architect');
    expect(actor.capabilities.has('engineering-decision:approve')).toBe(true);
    expect(actor.capabilities.has('baseline:create')).toBe(true);
    expect(actor.capabilities.has('policy-constraint:author')).toBe(true);
  });

  it('enforces Agent Isolation Invariant: strips human approval capabilities from agents', () => {
    const mapper = new ConfigurableClaimMapper();
    // Agent claiming lead-architect and requirements-reviewer roles
    const actor = mapper.mapClaimsToActor({
      sub: 'agent:gpt-4o',
      iss: 'http://localhost:8080/realms/solutions-studio',
      aud: 'solutions-studio-api',
      exp: Math.floor(Date.now() / 1000) + 3600,
      name: 'Automated Generation Agent',
      actorType: 'agent',
      realm_access: {
        roles: ['lead-architect', 'requirements-reviewer', 'solution-architect']
      }
    });

    expect(actor.actorType).toBe('agent');
    // Human approval capabilities MUST be stripped
    expect(actor.capabilities.has('requirements:reconcile')).toBe(false);
    expect(actor.capabilities.has('candidate:approve')).toBe(false);
    expect(actor.capabilities.has('engineering-decision:approve')).toBe(false);
    expect(actor.capabilities.has('baseline:create')).toBe(false);

    // Non-approval capabilities remain permitted
    expect(actor.capabilities.has('engineering-decision:author')).toBe(true);
    expect(actor.capabilities.has('projection:generate')).toBe(true);
  });

  it('strips operator:admin from non-human actors as well', () => {
    const mapper = new ConfigurableClaimMapper();
    const actor = mapper.mapClaimsToActor({
      sub: 'system:service-account',
      iss: 'http://localhost:8080/realms/solutions-studio',
      aud: 'solutions-studio-api',
      exp: Math.floor(Date.now() / 1000) + 3600,
      roles: ['solutions-studio-admin']
    });

    expect(actor.actorType).toBe('system');
    expect(actor.capabilities.has('operator:admin')).toBe(false);
  });

  it('classifies standard Keycloak service-account token as system and strips approval capabilities', () => {
    const mapper = new ConfigurableClaimMapper();
    // Realistic Keycloak service account token:
    // UUID sub, preferred_username=service-account-<clientId>, azp!=sub
    const actor = mapper.mapClaimsToActor({
      sub: '550e8400-e29b-41d4-a716-446655440000',
      iss: 'http://localhost:8080/realms/solutions-studio',
      aud: 'solutions-studio-api',
      azp: 'solutions-studio-cli',
      preferred_username: 'service-account-solutions-studio-cli',
      exp: Math.floor(Date.now() / 1000) + 3600,
      realm_access: {
        roles: ['requirements-reviewer', 'lead-architect']
      }
    });

    expect(actor.actorType).toBe('system');
    expect(actor.capabilities.has('requirements:reconcile')).toBe(false);
    expect(actor.capabilities.has('candidate:approve')).toBe(false);
    expect(actor.capabilities.has('engineering-decision:approve')).toBe(false);
    expect(actor.capabilities.has('baseline:create')).toBe(false);
    // Non-approval capabilities remain
    expect(actor.capabilities.has('engineering-decision:author')).toBe(true);
  });

  it('refuses to classify service account as human even if token contains actorType: human claim', () => {
    const mapper = new ConfigurableClaimMapper();
    const actor = mapper.mapClaimsToActor({
      sub: '550e8400-e29b-41d4-a716-446655440000',
      iss: 'http://localhost:8080/realms/solutions-studio',
      aud: 'solutions-studio-api',
      azp: 'solutions-studio-cli',
      preferred_username: 'service-account-solutions-studio-cli',
      actorType: 'human', // Adversarial claim attempting to bypass agent isolation
      exp: Math.floor(Date.now() / 1000) + 3600,
      realm_access: {
        roles: ['requirements-reviewer']
      }
    });

    expect(actor.actorType).toBe('system');
    expect(actor.capabilities.has('requirements:reconcile')).toBe(false);
    expect(actor.capabilities.has('candidate:approve')).toBe(false);
  });

  it('defaults ambiguous token without human profile claims to system', () => {
    const mapper = new ConfigurableClaimMapper();
    const actor = mapper.mapClaimsToActor({
      sub: '550e8400-e29b-41d4-a716-446655440000',
      iss: 'http://localhost:8080/realms/solutions-studio',
      aud: 'solutions-studio-api',
      exp: Math.floor(Date.now() / 1000) + 3600,
      realm_access: {
        roles: ['requirements-reviewer']
      }
    });

    expect(actor.actorType).toBe('system');
    expect(actor.capabilities.has('requirements:reconcile')).toBe(false);
  });
});
