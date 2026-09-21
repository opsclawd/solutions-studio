import type { AuthenticatedActor, ApplicationCapability } from '@solutions-studio/domain';

export interface IAuthorizationPolicy {
  authorize(actor: AuthenticatedActor, capability: ApplicationCapability): void;
  isAuthorized(actor: AuthenticatedActor, capability: ApplicationCapability): boolean;
}
