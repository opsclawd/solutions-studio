import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { StoryDependencyGraphDtoSchema } from '@solutions-studio/contracts';
import type { BuildStoryDependencyGraphUseCase } from '../../application/use-cases/BuildStoryDependencyGraphUseCase.js';
import { mapStoryDependencyGraphToDto } from '../dto-mappers.js';

export interface DependencyGraphRoutesOptions {
  readonly buildStoryDependencyGraphUseCase: BuildStoryDependencyGraphUseCase;
}

const baselineParamsSchema = z.object({
  baselineId: z.string().min(1)
});

const graphQuerySchema = z.object({
  includeReadiness: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((val) => val === true || val === 'true')
    .optional(),
  strict: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((val) => val === true || val === 'true')
    .optional()
});

export const dependencyGraphRoutes: FastifyPluginAsync<DependencyGraphRoutesOptions> = async (
  app,
  options
) => {
  app.get<{
    Params: z.infer<typeof baselineParamsSchema>;
    Querystring: z.infer<typeof graphQuerySchema>;
  }>(
    '/api/baselines/:baselineId/dependency-graph',
    {
      schema: {
        params: baselineParamsSchema,
        querystring: graphQuerySchema,
        response: {
          200: StoryDependencyGraphDtoSchema
        }
      }
    },
    async (request, reply) => {
      const graph = await options.buildStoryDependencyGraphUseCase.execute({
        baselineId: request.params.baselineId,
        includeReadiness: request.query.includeReadiness ?? true,
        strict: request.query.strict ?? false
      });
      return reply.status(200).send(mapStoryDependencyGraphToDto(graph));
    }
  );
};
