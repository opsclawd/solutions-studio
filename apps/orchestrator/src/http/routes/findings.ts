import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  DispositionFindingRequestDtoSchema,
  ReopenFindingRequestDtoSchema
} from '@solutions-studio/contracts';
import type { ReconcileRequirementsUseCase } from '../../application/use-cases/ReconcileRequirementsUseCase.js';
import type { IAuthorizationPolicy } from '../../application/ports/identity/IAuthorizationPolicy.js';
import { AuthenticationError } from '../../application/ports/identity/IdentityErrors.js';
import { mapCandidateFindingToDto } from '../dto-mappers.js';

export interface FindingsRoutesOptions {
  readonly reconcileUseCase: ReconcileRequirementsUseCase;
  readonly authorizer?: IAuthorizationPolicy;
}

const findingParamsSchema = z.object({
  findingId: z.string().min(1)
});

export const findingsRoutes: FastifyPluginAsync<FindingsRoutesOptions> = async (app, options) => {
  app.post<{
    Params: z.infer<typeof findingParamsSchema>;
    Body: z.infer<typeof DispositionFindingRequestDtoSchema>;
  }>(
    '/api/findings/:findingId/disposition',
    {
      schema: {
        params: findingParamsSchema,
        body: DispositionFindingRequestDtoSchema
      }
    },
    async (request, reply) => {
      if (options.authorizer) {
        if (!request.actor) {
          throw new AuthenticationError('Unauthenticated request', { reason: 'NO_ACTOR' });
        }
        options.authorizer.authorize(request.actor, 'candidate:approve');
      }

      const actorId = request.actor?.id ?? request.body.actorId;
      const result = await options.reconcileUseCase.dispositionFinding({
        findingId: request.params.findingId,
        ...request.body,
        actorId
      });
      return reply.status(200).send(mapCandidateFindingToDto(result));
    }
  );

  app.post<{
    Params: z.infer<typeof findingParamsSchema>;
    Body: z.infer<typeof ReopenFindingRequestDtoSchema>;
  }>(
    '/api/findings/:findingId/reopen',
    {
      schema: {
        params: findingParamsSchema,
        body: ReopenFindingRequestDtoSchema
      }
    },
    async (request, reply) => {
      if (options.authorizer) {
        if (!request.actor) {
          throw new AuthenticationError('Unauthenticated request', { reason: 'NO_ACTOR' });
        }
        options.authorizer.authorize(request.actor, 'requirements:reconcile');
      }

      const actorId = request.actor?.id ?? request.body.actorId;
      const result = await options.reconcileUseCase.reopenFinding({
        findingId: request.params.findingId,
        ...request.body,
        actorId
      });
      return reply.status(200).send(mapCandidateFindingToDto(result));
    }
  );
};
