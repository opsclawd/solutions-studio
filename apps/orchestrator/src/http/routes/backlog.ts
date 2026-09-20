import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  ExportBacklogRequestDtoSchema,
  ExportBacklogResponseDtoSchema,
  BacklogExportFilterDtoSchema,
  BacklogExportMappingListResponseDtoSchema,
  type ExportBacklogRequestDto,
  type BacklogExportFilterDto
} from '@solutions-studio/contracts';
import type { ExportBacklogUseCase } from '../../application/use-cases/ExportBacklogUseCase.js';
import type { GetBacklogExportMappingsUseCase } from '../../application/use-cases/GetBacklogExportMappingsUseCase.js';
import type { IAuthorizationPolicy } from '../../application/ports/identity/IAuthorizationPolicy.js';
import { AuthenticationError } from '../../application/ports/identity/IdentityErrors.js';
import { mapBacklogExportMappingToDto } from '../dto-mappers.js';

export interface BacklogRoutesOptions {
  readonly exportBacklogUseCase: ExportBacklogUseCase;
  readonly getBacklogExportMappingsUseCase: GetBacklogExportMappingsUseCase;
  readonly authorizer?: IAuthorizationPolicy;
}

const baselineParamsSchema = z.object({
  baselineId: z.string().min(1)
});

export const backlogRoutes: FastifyPluginAsync<BacklogRoutesOptions> = async (app, options) => {
  app.post<{
    Params: z.infer<typeof baselineParamsSchema>;
    Body: ExportBacklogRequestDto;
  }>(
    '/api/baselines/:baselineId/export/backlog',
    {
      schema: {
        params: baselineParamsSchema,
        body: ExportBacklogRequestDtoSchema,
        response: {
          200: ExportBacklogResponseDtoSchema
        }
      }
    },
    async (request, reply) => {
      if (!request.actor || Boolean(request.actor.metadata?.isAnonymousFallback)) {
        throw new AuthenticationError(
          'Explicit authentication required for backlog export operations',
          {
            reason: 'AUTHENTICATION_REQUIRED'
          }
        );
      }

      if (options.authorizer) {
        options.authorizer.authorize(request.actor, 'backlog:export');
      }

      const result = await options.exportBacklogUseCase.execute({
        baselineId: request.params.baselineId,
        provider: request.body.provider,
        targetContainer: request.body.targetContainer,
        storyIds: request.body.storyIds,
        forceUpdate: request.body.forceUpdate,
        credentials: request.body.credentials,
        actor: request.actor
      });

      return reply.status(200).send(result);
    }
  );

  app.get<{
    Params: z.infer<typeof baselineParamsSchema>;
    Querystring: BacklogExportFilterDto;
  }>(
    '/api/baselines/:baselineId/export/backlog/mappings',
    {
      schema: {
        params: baselineParamsSchema,
        querystring: BacklogExportFilterDtoSchema,
        response: {
          200: BacklogExportMappingListResponseDtoSchema
        }
      }
    },
    async (request, reply) => {
      if (!request.actor || Boolean(request.actor.metadata?.isAnonymousFallback)) {
        throw new AuthenticationError(
          'Explicit authentication required for backlog export operations',
          {
            reason: 'AUTHENTICATION_REQUIRED'
          }
        );
      }

      if (options.authorizer) {
        options.authorizer.authorize(request.actor, 'backlog:export');
      }

      const mappings = await options.getBacklogExportMappingsUseCase.execute({
        baselineId: request.params.baselineId,
        storyId: request.query.storyId,
        provider: request.query.provider,
        externalContainer: request.query.externalContainer,
        actor: request.actor
      });

      return reply.status(200).send({
        items: mappings.map(mapBacklogExportMappingToDto)
      });
    }
  );
};
