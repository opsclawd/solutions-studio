import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { EngineeringHandoffBundleDtoSchema } from '@solutions-studio/contracts';
import type { GetEngineeringHandoffBundleUseCase } from '../../application/use-cases/GetEngineeringHandoffBundleUseCase.js';
import { mapEngineeringHandoffBundleToDto } from '../dto-mappers.js';

export interface HandoffRoutesOptions {
  readonly getEngineeringHandoffBundleUseCase: GetEngineeringHandoffBundleUseCase;
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
      const bundle = await options.getEngineeringHandoffBundleUseCase.execute({
        baselineId: request.params.baselineId
      });
      return reply.status(200).send(mapEngineeringHandoffBundleToDto(bundle));
    }
  );
};
