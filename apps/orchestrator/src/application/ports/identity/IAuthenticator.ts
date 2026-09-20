import type { AuthenticatedActor } from '@solutions-studio/domain';

export interface IdentityHealthReport {
  readonly status: 'healthy' | 'unhealthy';
  readonly provider: string;
  readonly issuer?: string;
  readonly reachable: boolean;
  readonly latencyMs?: number;
  readonly error?: string;
}

export interface IAuthenticator {
  authenticate(token?: string): Promise<AuthenticatedActor>;
  checkHealth?(): Promise<IdentityHealthReport>;
}
