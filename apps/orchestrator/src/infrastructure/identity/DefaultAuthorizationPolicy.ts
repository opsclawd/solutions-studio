import {
  hasCapability,
  type AuthenticatedActor,
  type ApplicationCapability
} from '@solutions-studio/domain';
import {
  ForbiddenError,
  type IAuthorizationPolicy
} from '../../application/ports/identity/index.js';

export class DefaultAuthorizationPolicy implements IAuthorizationPolicy {
  isAuthorized(actor: AuthenticatedActor, capability: ApplicationCapability): boolean {
    return hasCapability(actor, capability);
  }

  authorize(actor: AuthenticatedActor, capability: ApplicationCapability): void {
    if (!this.isAuthorized(actor, capability)) {
      throw new ForbiddenError(
        `Actor '${actor.id}' is not authorized to perform action requiring capability '${capability}'`,
        capability,
        actor.id
      );
    }
  }
}
