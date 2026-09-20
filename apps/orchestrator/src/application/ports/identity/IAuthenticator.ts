import type { AuthenticatedActor } from '@solutions-studio/domain';

export interface IAuthenticator {
  authenticate(token?: string): Promise<AuthenticatedActor>;
}
