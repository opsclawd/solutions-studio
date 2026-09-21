export const AUTH_TOKEN_KEY = 'solutions-studio-auth-token';
export const AUTH_PERSONA_KEY = 'solutions-studio-auth-persona';

export interface PersonaDefinition {
  readonly id: string;
  readonly label: string;
  readonly actorId: string;
  readonly role: string;
  readonly token: string;
  readonly capabilities: readonly string[];
}

export const PRESET_PERSONAS: readonly PersonaDefinition[] = [
  {
    id: 'anonymous',
    label: 'Anonymous (Test Fallback)',
    actorId: 'lead-reviewer',
    role: 'All Capabilities (Dev Fallback)',
    token: '',
    capabilities: [
      'requirements:reconcile',
      'candidate:approve',
      'baseline:create',
      'engineering-decision:author',
      'engineering-decision:approve',
      'policy-constraint:author',
      'projection:generate',
      'backlog:export'
    ]
  },
  {
    id: 'reviewer.alice',
    label: 'Alice (Requirements Reviewer)',
    actorId: 'reviewer.alice',
    role: 'requirements-reviewer',
    token: 'test:reviewer',
    capabilities: ['requirements:reconcile', 'candidate:approve', 'baseline:create']
  },
  {
    id: 'architect.bob',
    label: 'Bob (Lead Architect)',
    actorId: 'architect.bob',
    role: 'lead-architect',
    token: 'test:architect',
    capabilities: [
      'engineering-decision:approve',
      'engineering-decision:author',
      'baseline:create',
      'policy-constraint:author'
    ]
  },
  {
    id: 'admin.carol',
    label: 'Carol (Solutions Studio Admin)',
    actorId: 'admin.carol',
    role: 'solutions-studio-admin',
    token: 'test:admin',
    capabilities: ['operator:admin']
  },
  {
    id: 'viewer.dave',
    label: 'Dave (Viewer)',
    actorId: 'viewer.dave',
    role: 'solutions-studio-viewer',
    token: 'test:viewer',
    capabilities: []
  },
  {
    id: 'custom',
    label: 'Custom Bearer Token',
    actorId: 'custom-principal',
    role: 'custom',
    token: '',
    capabilities: []
  }
];

let inMemoryToken: string | null = null;
let inMemoryPersona: string = 'anonymous';

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    return window.sessionStorage;
  }
  if (typeof globalThis !== 'undefined' && globalThis.sessionStorage) {
    return globalThis.sessionStorage;
  }
  return null;
}

export function getAuthToken(): string | null {
  const storage = getStorage();
  if (!storage) {
    return inMemoryToken;
  }
  try {
    return storage.getItem(AUTH_TOKEN_KEY) ?? inMemoryToken;
  } catch {
    return inMemoryToken;
  }
}

export function setAuthToken(token: string | null): void {
  inMemoryToken = token;
  const storage = getStorage();
  if (storage) {
    try {
      if (token) {
        storage.setItem(AUTH_TOKEN_KEY, token);
      } else {
        storage.removeItem(AUTH_TOKEN_KEY);
      }
    } catch {
      // Ignore storage errors in restricted contexts
    }
  }
}

export function getSelectedPersona(): string {
  const storage = getStorage();
  if (!storage) {
    return inMemoryPersona;
  }
  try {
    return storage.getItem(AUTH_PERSONA_KEY) ?? inMemoryPersona;
  } catch {
    return inMemoryPersona;
  }
}

export function setSelectedPersona(personaId: string): void {
  inMemoryPersona = personaId;
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(AUTH_PERSONA_KEY, personaId);
    } catch {
      // Ignore storage errors in restricted contexts
    }
  }
}

export function resetAuthStore(): void {
  inMemoryToken = null;
  inMemoryPersona = 'anonymous';
  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(AUTH_TOKEN_KEY);
      storage.removeItem(AUTH_PERSONA_KEY);
    } catch {
      // Ignore
    }
  }
}
