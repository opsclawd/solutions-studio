import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { GetRequirementsReviewStateUseCase } from '../../application/use-cases/GetRequirementsReviewStateUseCase.js';
import { mapReviewStateToDto } from '../dto-mappers.js';

export interface ReviewRoutesOptions {
  readonly reviewStateUseCase: GetRequirementsReviewStateUseCase;
}

export const reviewRoutes: FastifyPluginAsync<ReviewRoutesOptions> = async (app, options) => {
  const querySchema = z.object({
    baselineId: z.string().min(1).optional()
  });

  app.get<{ Querystring: z.infer<typeof querySchema> }>(
    '/api/requirements/review-state',
    {
      schema: {
        querystring: querySchema
      }
    },
    async (request, reply) => {
      const result = await options.reviewStateUseCase.get({
        baselineId: request.query.baselineId
      });
      return reply.status(200).send(mapReviewStateToDto(result));
    }
  );
};
