import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  DispositionFindingRequestDtoSchema,
  ReopenFindingRequestDtoSchema
} from '@solutions-studio/contracts';
import type { ReconcileRequirementsUseCase } from '../../application/use-cases/ReconcileRequirementsUseCase.js';
import { mapCandidateFindingToDto } from '../dto-mappers.js';

export interface FindingsRoutesOptions {
  readonly reconcileUseCase: ReconcileRequirementsUseCase;
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
      const result = await options.reconcileUseCase.dispositionFinding({
        findingId: request.params.findingId,
        ...request.body
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
      const result = await options.reconcileUseCase.reopenFinding({
        findingId: request.params.findingId,
        ...request.body
      });
      return reply.status(200).send(mapCandidateFindingToDto(result));
    }
  );
};
