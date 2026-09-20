import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { CreatePolicyConstraintRevisionRequestDtoSchema } from '@solutions-studio/contracts';
import type { RecordPolicyConstraintRevisionUseCase } from '../../application/use-cases/RecordPolicyConstraintRevisionUseCase.js';
import type { GetPolicyConstraintRevisionUseCase } from '../../application/use-cases/GetPolicyConstraintRevisionUseCase.js';
import type { IAuthorizationPolicy } from '../../application/ports/identity/IAuthorizationPolicy.js';
import { AuthenticationError } from '../../application/ports/identity/IdentityErrors.js';
import { mapPolicyConstraintRevisionToDto } from '../dto-mappers.js';

export interface PolicyConstraintsRoutesOptions {
  readonly recordPolicyConstraintRevisionUseCase: RecordPolicyConstraintRevisionUseCase;
  readonly getPolicyConstraintRevisionUseCase: GetPolicyConstraintRevisionUseCase;
  readonly authorizer?: IAuthorizationPolicy;
}

const revisionParamsSchema = z.object({
  revisionId: z.string().min(1)
});

export const policyConstraintsRoutes: FastifyPluginAsync<PolicyConstraintsRoutesOptions> = async (
  app,
  options
) => {
  app.post<{
    Body: z.infer<typeof CreatePolicyConstraintRevisionRequestDtoSchema>;
  }>(
    '/api/policy-constraints',
    {
      schema: {
        body: CreatePolicyConstraintRevisionRequestDtoSchema
      }
    },
    async (request, reply) => {
      if (options.authorizer) {
        if (!request.actor) {
          throw new AuthenticationError('Unauthenticated request', { reason: 'NO_ACTOR' });
        }
        options.authorizer.authorize(request.actor, 'policy-constraint:author');
      }

      const createdBy = request.actor?.id ?? request.body.createdBy ?? 'lead-architect';
      const result = await options.recordPolicyConstraintRevisionUseCase.execute({
        ...request.body,
        createdBy
      });
      return reply.status(201).send(mapPolicyConstraintRevisionToDto(result));
    }
  );

  app.get<{
    Params: z.infer<typeof revisionParamsSchema>;
  }>(
    '/api/policy-constraints/:revisionId',
    {
      schema: {
        params: revisionParamsSchema
      }
    },
    async (request, reply) => {
      const result = await options.getPolicyConstraintRevisionUseCase.execute({
        revisionId: request.params.revisionId
      });
      return reply.status(200).send(mapPolicyConstraintRevisionToDto(result));
    }
  );
};
