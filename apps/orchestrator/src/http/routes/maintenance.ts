import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  MaintenanceRetentionRequestSchema,
  MaintenanceRetentionResponseSchema
} from '@solutions-studio/contracts';
import type { PruneRetentionUseCase } from '../../application/use-cases/PruneRetentionUseCase.js';

export interface MaintenanceRoutesOptions {
  readonly pruneRetentionUseCase?: PruneRetentionUseCase;
}

export const maintenanceRoutes: FastifyPluginAsync<MaintenanceRoutesOptions> = async (
  fastify,
  opts
) => {
  const server = fastify.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/api/admin/maintenance/retention',
    {
      schema: {
        body: MaintenanceRetentionRequestSchema.optional(),
        response: {
          200: MaintenanceRetentionResponseSchema,
          503: MaintenanceRetentionResponseSchema
        }
      }
    },
    async (request, reply) => {
      if (!opts.pruneRetentionUseCase) {
        return reply.status(503).send({
          status: 'failed',
          timestamp: new Date().toISOString(),
          dryRun: false,
          prunedFixturesCount: 0,
          prunedSummariesCount: 0,
          retainedSummariesCount: 0,
          error: 'Retention lifecycle pruner is not configured for this storage topology.'
        });
      }

      const body = request.body ?? {};
      const result = await opts.pruneRetentionUseCase.execute(body, request.actor);
      return reply.status(200).send(result);
    }
  );
};
