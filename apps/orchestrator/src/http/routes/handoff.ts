import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { EngineeringHandoffBundleDtoSchema } from '@solutions-studio/contracts';
import type { GetEngineeringHandoffBundleUseCase } from '../../application/use-cases/GetEngineeringHandoffBundleUseCase.js';
import type { IAuthorizationPolicy } from '../../application/ports/identity/IAuthorizationPolicy.js';
import { AuthenticationError } from '../../application/ports/identity/IdentityErrors.js';
import { mapEngineeringHandoffBundleToDto } from '../dto-mappers.js';

export interface HandoffRoutesOptions {
  readonly getEngineeringHandoffBundleUseCase: GetEngineeringHandoffBundleUseCase;
  readonly authorizer?: IAuthorizationPolicy;
}

const baselineParamsSchema = z.object({
  baselineId: z.string().min(1)
});

export const handoffRoutes: FastifyPluginAsync<HandoffRoutesOptions> = async (app, options) => {
  app.get<{
    Params: z.infer<typeof baselineParamsSchema>;
  }>(
    '/api/baselines/:baselineId/handoff',
    {
      schema: {
        params: baselineParamsSchema,
        response: {
          200: EngineeringHandoffBundleDtoSchema
        }
      }
    },
    async (request, reply) => {
      if (options.authorizer) {
        if (!request.actor) {
          throw new AuthenticationError('Unauthenticated request', { reason: 'NO_ACTOR' });
        }
        options.authorizer.authorize(request.actor, 'backlog:export');
      }

      const bundle = await options.getEngineeringHandoffBundleUseCase.execute({
        baselineId: request.params.baselineId
      });
      return reply.status(200).send(mapEngineeringHandoffBundleToDto(bundle));
    }
  );
};
