import type { AuthenticatedActor } from '@solutions-studio/domain';

export interface ValidatedTokenClaims {
  readonly sub: string;
  readonly iss: string;
  readonly aud: string | readonly string[];
  readonly exp: number;
  readonly nbf?: number;
  readonly name?: string;
  readonly preferred_username?: string;
  readonly email?: string;
  readonly realm_access?: { readonly roles?: readonly string[] };
  readonly resource_access?: Record<string, { readonly roles?: readonly string[] }>;
  readonly roles?: readonly string[];
  readonly groups?: readonly string[];
  readonly actorType?: string;
  readonly [key: string]: unknown;
}

export interface IClaimMapper {
  mapClaimsToActor(claims: ValidatedTokenClaims): AuthenticatedActor;
}
