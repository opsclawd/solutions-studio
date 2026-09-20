import {
  createAuthenticatedActor,
  type AuthenticatedActor,
  type ApplicationCapability,
  type ActorType
} from '@solutions-studio/domain';
import type { IClaimMapper, ValidatedTokenClaims } from '../../application/ports/identity/index.js';

export interface ClaimMapperOptions {
  readonly roleToCapabilityMap?: Record<string, readonly ApplicationCapability[]>;
  readonly defaultCapabilities?: readonly ApplicationCapability[];
  readonly clientId?: string;
}

const HUMAN_APPROVAL_CAPABILITIES: ReadonlySet<ApplicationCapability> = new Set([
  'requirements:reconcile',
  'candidate:approve',
  'engineering-decision:approve',
  'baseline:create'
]);

export const DEFAULT_ROLE_CAPABILITY_MAP: Record<string, readonly ApplicationCapability[]> = {
  // Keycloak realm / client roles
  'requirements-reviewer': ['requirements:reconcile', 'candidate:approve'],
  'requirements-author': ['requirements:reconcile'],
  'lead-architect': [
    'engineering-decision:approve',
    'engineering-decision:author',
    'baseline:create',
    'policy-constraint:author'
  ],
  'solution-architect': ['engineering-decision:author', 'projection:generate'],
  'delivery-lead': ['backlog:export'],
  'solutions-studio-admin': ['operator:admin'],
  'solutions-studio-viewer': [],

  // Microsoft Entra ID App Roles
  'SolutionsStudio.Reviewer': ['requirements:reconcile', 'candidate:approve'],
  'SolutionsStudio.Architect': [
    'engineering-decision:approve',
    'engineering-decision:author',
    'baseline:create',
    'policy-constraint:author'
  ],
  'SolutionsStudio.Admin': ['operator:admin'],
  'SolutionsStudio.Exporter': ['backlog:export'],
  'SolutionsStudio.Viewer': []
};

export class ConfigurableClaimMapper implements IClaimMapper {
  private readonly roleMap: Record<string, readonly ApplicationCapability[]>;
  private readonly defaultCapabilities: readonly ApplicationCapability[];
  private readonly clientId?: string;

  constructor(options: ClaimMapperOptions = {}) {
    this.roleMap = {
      ...DEFAULT_ROLE_CAPABILITY_MAP,
      ...(options.roleToCapabilityMap ?? {})
    };
    this.defaultCapabilities = options.defaultCapabilities ?? [];
    this.clientId = options.clientId;
  }

  mapClaimsToActor(claims: ValidatedTokenClaims): AuthenticatedActor {
    const rawRoles = this.extractRoles(claims);
    const actorType = this.determineActorType(claims, rawRoles);

    const capabilitiesSet = new Set<ApplicationCapability>(this.defaultCapabilities);

    for (const role of rawRoles) {
      const mapped = this.roleMap[role];
      if (mapped) {
        for (const cap of mapped) {
          capabilitiesSet.add(cap);
        }
      }
    }

    // Invariant 1: Agent Isolation Invariant
    // If actor is not human, strip all human approval capabilities
    if (actorType !== 'human') {
      for (const cap of HUMAN_APPROVAL_CAPABILITIES) {
        capabilitiesSet.delete(cap);
      }
      if (capabilitiesSet.has('operator:admin')) {
        capabilitiesSet.delete('operator:admin');
      }
    }

    // Derive stable internal identity string
    const id =
      claims.preferred_username ||
      (typeof claims.upn === 'string' ? claims.upn : undefined) ||
      (typeof claims.oid === 'string' ? claims.oid : undefined) ||
      claims.sub;

    const name =
      claims.name ||
      claims.preferred_username ||
      (typeof claims.upn === 'string' ? claims.upn : undefined) ||
      claims.sub;

    const email =
      claims.email ||
      (typeof claims.upn === 'string' && claims.upn.includes('@') ? claims.upn : undefined);

    return createAuthenticatedActor({
      id,
      name,
      email,
      actorType,
      capabilities: capabilitiesSet,
      metadata: {
        issuer: claims.iss,
        roles: rawRoles
      }
    });
  }

  private extractRoles(claims: ValidatedTokenClaims): string[] {
    const roles: string[] = [];

    // Top-level roles claim (e.g. Entra ID App Roles or standard OAuth)
    if (Array.isArray(claims.roles)) {
      for (const r of claims.roles) {
        if (typeof r === 'string') roles.push(r);
      }
    }

    // Keycloak realm_access.roles
    if (Array.isArray(claims.realm_access?.roles)) {
      for (const r of claims.realm_access.roles) {
        if (typeof r === 'string') roles.push(r);
      }
    }

    // Keycloak resource_access[client].roles
    if (this.clientId && claims.resource_access?.[this.clientId]?.roles) {
      const clientRoles = claims.resource_access[this.clientId].roles;
      if (Array.isArray(clientRoles)) {
        for (const r of clientRoles) {
          if (typeof r === 'string') roles.push(r);
        }
      }
    }

    // Top-level groups claim (e.g. Entra ID groups)
    if (Array.isArray(claims.groups)) {
      for (const g of claims.groups) {
        if (typeof g === 'string') roles.push(g);
      }
    }

    return Array.from(new Set(roles));
  }

  private determineActorType(claims: ValidatedTokenClaims, roles: string[]): ActorType {
    // 1. Explicit machine actorType declarations
    if (claims.actorType === 'agent') {
      return 'agent';
    }
    if (claims.actorType === 'system') {
      return 'system';
    }

    // 2. Machine indicators MUST take precedence over any asserted human hints
    // Keycloak service-account tokens (sub is UUID or starts with service-account, preferred_username=service-account-<client>)
    if (
      (typeof claims.preferred_username === 'string' &&
        claims.preferred_username.startsWith('service-account-')) ||
      claims.sub.startsWith('service-account-')
    ) {
      return 'system';
    }

    // Prefixed subject indicators
    if (claims.sub.startsWith('agent:')) {
      return 'agent';
    }
    if (claims.sub.startsWith('system:')) {
      return 'system';
    }

    // Role-based machine indicators
    if (roles.includes('agent')) {
      return 'agent';
    }
    if (roles.includes('system')) {
      return 'system';
    }

    // OAuth 2.0 client credentials indicators
    if (
      claims.grant_type === 'client_credentials' ||
      claims.gty === 'client-credentials' ||
      (claims.azp && claims.azp === claims.sub)
    ) {
      return 'system';
    }

    // Entra ID app-only (service principal) token indicators
    if (claims.idtyp === 'app') {
      return 'system';
    }
    if (claims.appid && (!claims.upn || claims.upn === claims.appid) && !claims.email) {
      return 'system';
    }

    // 3. Accepted human hint only if NO machine evidence was detected
    if (claims.actorType === 'human') {
      return 'human';
    }

    // 4. Human profile indicators (email, upn, or non-service-account preferred_username)
    const hasEmail = typeof claims.email === 'string' && claims.email.includes('@');
    const hasUpn = typeof claims.upn === 'string' && claims.upn.includes('@');
    const hasHumanUsername =
      typeof claims.preferred_username === 'string' &&
      !claims.preferred_username.startsWith('service-account-') &&
      claims.preferred_username !== claims.azp;

    if (hasEmail || hasUpn || hasHumanUsername) {
      return 'human';
    }

    // 5. Default ambiguous principals without human profile claims to system (fail closed)
    return 'system';
  }
}
