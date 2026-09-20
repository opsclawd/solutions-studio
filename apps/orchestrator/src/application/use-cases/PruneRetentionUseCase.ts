import type { AuthenticatedActor } from '@solutions-studio/domain';
import { AuthenticationError } from '../ports/identity/IdentityErrors.js';
import type { IAuthorizationPolicy } from '../ports/identity/IAuthorizationPolicy.js';
import type {
  IRetentionPruner,
  RetentionPruneOptions,
  RetentionPruneOutput
} from '../ports/maintenance/IRetentionPruner.js';

export class PruneRetentionUseCase {
  constructor(
    private readonly pruner: IRetentionPruner,
    private readonly authorizer: IAuthorizationPolicy
  ) {}

  async execute(
    options?: RetentionPruneOptions,
    actor?: AuthenticatedActor
  ): Promise<RetentionPruneOutput> {
    if (!actor) {
      throw new AuthenticationError('Authentication required to execute retention maintenance.', {
        reason: 'UNAUTHENTICATED'
      });
    }
    this.authorizer.authorize(actor, 'operator:admin');
    return this.pruner.prune(options);
  }
}
