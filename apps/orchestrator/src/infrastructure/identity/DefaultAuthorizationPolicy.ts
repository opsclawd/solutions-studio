import {
  hasCapability,
  type AuthenticatedActor,
  type ApplicationCapability
} from '@solutions-studio/domain';
import {
  ForbiddenError,
  type IAuthorizationPolicy
} from '../../application/ports/identity/index.js';
import type { ITelemetryRegistry } from '../../application/ports/observability/ITelemetryRegistry.js';
import { TelemetryRegistry } from '../observability/TelemetryRegistry.js';

export class DefaultAuthorizationPolicy implements IAuthorizationPolicy {
  constructor(private readonly telemetryRegistry?: ITelemetryRegistry) {}

  isAuthorized(actor: AuthenticatedActor, capability: ApplicationCapability): boolean {
    return hasCapability(actor, capability);
  }

  authorize(actor: AuthenticatedActor, capability: ApplicationCapability): void {
    if (!this.isAuthorized(actor, capability)) {
      const registry = this.telemetryRegistry ?? TelemetryRegistry.default;
      registry.incrementCounter('solutions_studio_authz_failures_total', {
        required_capability: capability,
        actor_type: actor.actorType
      });
      throw new ForbiddenError(
        `Actor '${actor.id}' is not authorized to perform action requiring capability '${capability}'`,
        capability,
        actor.id
      );
    }
  }
}
