import { createActorId, type ActorId } from '../requirements/ids.js';

export const ACTOR_TYPES = ['human', 'system', 'agent'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const APPLICATION_CAPABILITIES = [
  'requirements:reconcile',
  'candidate:approve',
  'policy-constraint:author',
  'engineering-decision:author',
  'engineering-decision:approve',
  'baseline:create',
  'projection:generate',
  'backlog:export',
  'operator:admin'
] as const;

export type ApplicationCapability = (typeof APPLICATION_CAPABILITIES)[number];

const VALID_CAPABILITIES = new Set<string>(APPLICATION_CAPABILITIES);

export interface AuthenticatedActor {
  readonly id: ActorId;
  readonly name: string;
  readonly email?: string;
  readonly actorType: ActorType;
  readonly capabilities: ReadonlySet<ApplicationCapability>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CreateAuthenticatedActorProps {
  readonly id: ActorId | string;
  readonly name: string;
  readonly email?: string;
  readonly actorType: ActorType;
  readonly capabilities: Iterable<ApplicationCapability>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function isValidCapability(value: unknown): value is ApplicationCapability {
  return typeof value === 'string' && VALID_CAPABILITIES.has(value);
}

class ImmutableSet<T> extends Set<T> {
  private readonly _frozen: boolean = false;

  constructor(entries?: Iterable<T>) {
    super(entries);
    this._frozen = true;
  }

  override add(value: T): this {
    if (this._frozen) {
      throw new Error('Cannot modify immutable set');
    }
    return super.add(value);
  }

  override delete(value: T): boolean {
    if (this._frozen) {
      throw new Error('Cannot modify immutable set');
    }
    return super.delete(value);
  }

  override clear(): void {
    if (this._frozen) {
      throw new Error('Cannot modify immutable set');
    }
    super.clear();
  }
}

export function createAuthenticatedActor(props: CreateAuthenticatedActorProps): AuthenticatedActor {
  const actorId = createActorId(props.id);

  if (typeof props.name !== 'string' || props.name.trim().length === 0) {
    throw new Error('AuthenticatedActor name must be a non-empty string');
  }

  if (!ACTOR_TYPES.includes(props.actorType)) {
    throw new Error(`Invalid actorType: '${props.actorType}'`);
  }

  const rawCapabilities: ApplicationCapability[] = [];
  if (props.capabilities) {
    for (const cap of props.capabilities) {
      if (!isValidCapability(cap)) {
        throw new Error(`Invalid ApplicationCapability: '${cap}'`);
      }
      rawCapabilities.push(cap);
    }
  }

  return Object.freeze({
    id: actorId,
    name: props.name.trim(),
    email: props.email?.trim() || undefined,
    actorType: props.actorType,
    capabilities: Object.freeze(new ImmutableSet(rawCapabilities)),
    metadata: props.metadata ? Object.freeze({ ...props.metadata }) : undefined
  });
}

export function hasCapability(
  actor: AuthenticatedActor,
  capability: ApplicationCapability
): boolean {
  if (actor.capabilities.has('operator:admin')) {
    return true;
  }
  return actor.capabilities.has(capability);
}
