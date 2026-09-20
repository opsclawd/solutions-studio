import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { TransitionEngineeringDecisionRequestDtoSchema } from '@solutions-studio/contracts';
import type { TransitionEngineeringDecisionUseCase } from '../../application/use-cases/TransitionEngineeringDecisionUseCase.js';
import type { GetEngineeringDecisionsUseCase } from '../../application/use-cases/GetEngineeringDecisionsUseCase.js';
import type { IAuthorizationPolicy } from '../../application/ports/identity/IAuthorizationPolicy.js';
import { AuthenticationError } from '../../application/ports/identity/IdentityErrors.js';
import { mapEngineeringDecisionToDto } from '../dto-mappers.js';

export interface DecisionsRoutesOptions {
  readonly transitionEngineeringDecisionUseCase: TransitionEngineeringDecisionUseCase;
  readonly getEngineeringDecisionsUseCase: GetEngineeringDecisionsUseCase;
  readonly authorizer?: IAuthorizationPolicy;
}

const decisionParamsSchema = z.object({
  decisionId: z.string().min(1)
});

export const decisionsRoutes: FastifyPluginAsync<DecisionsRoutesOptions> = async (app, options) => {
  app.get<{
    Params: z.infer<typeof decisionParamsSchema>;
  }>(
    '/api/decisions/:decisionId',
    {
      schema: {
        params: decisionParamsSchema
      }
    },
    async (request, reply) => {
      const result = await options.getEngineeringDecisionsUseCase.getById(
        request.params.decisionId
      );
      return reply.status(200).send(mapEngineeringDecisionToDto(result));
    }
  );

  app.post<{
    Params: z.infer<typeof decisionParamsSchema>;
    Body: z.infer<typeof TransitionEngineeringDecisionRequestDtoSchema>;
  }>(
    '/api/decisions/:decisionId/transition',
    {
      schema: {
        params: decisionParamsSchema,
        body: TransitionEngineeringDecisionRequestDtoSchema
      }
    },
    async (request, reply) => {
      if (options.authorizer) {
        if (!request.actor) {
          throw new AuthenticationError('Unauthenticated request', { reason: 'NO_ACTOR' });
        }
        options.authorizer.authorize(request.actor, 'engineering-decision:approve');
      }

      const actorId = request.actor?.id ?? request.body.actorId ?? 'lead-architect';
      const result = await options.transitionEngineeringDecisionUseCase.execute({
        decisionId: request.params.decisionId,
        newState: request.body.newState,
        rationale: request.body.rationale,
        actorId
      });
      return reply.status(200).send(mapEngineeringDecisionToDto(result));
    }
  );
};
