import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  CreateRequirementsBaselineRequestDtoSchema,
  GenerateProjectionRequestDtoSchema
} from '@solutions-studio/contracts';
import type { CreateRequirementsBaselineUseCase } from '../../application/use-cases/CreateRequirementsBaselineUseCase.js';
import type { ProjectBaselineUseCase } from '../../application/use-cases/ProjectBaselineUseCase.js';
import type { GetRequirementsReviewStateUseCase } from '../../application/use-cases/GetRequirementsReviewStateUseCase.js';
import { UnknownProjectionError } from '../../application/use-cases/DiscoveryErrors.js';
import { mapRequirementsBaselineToDto, mapProjectionRecordToDto } from '../dto-mappers.js';

export interface BaselinesRoutesOptions {
  readonly baselineUseCase: CreateRequirementsBaselineUseCase;
  readonly projectBaselineUseCase: ProjectBaselineUseCase;
  readonly reviewStateUseCase: GetRequirementsReviewStateUseCase;
}

const baselineParamsSchema = z.object({
  baselineId: z.string().min(1)
});

const baselineProjectionParamsSchema = z.object({
  baselineId: z.string().min(1),
  projectionId: z.string().min(1)
});

export const baselinesRoutes: FastifyPluginAsync<BaselinesRoutesOptions> = async (app, options) => {
  app.post<{
    Body: z.infer<typeof CreateRequirementsBaselineRequestDtoSchema>;
  }>(
    '/api/baselines',
    {
      schema: {
        body: CreateRequirementsBaselineRequestDtoSchema
      }
    },
    async (request, reply) => {
      const result = await options.baselineUseCase.create({
        id: request.body.id,
        requirementRevisionIds: request.body.requirementRevisions,
        createdBy: request.body.createdBy,
        createdAt: request.body.createdAt
      });
      return reply.status(200).send(mapRequirementsBaselineToDto(result));
    }
  );

  app.get<{
    Params: z.infer<typeof baselineParamsSchema>;
  }>(
    '/api/baselines/:baselineId',
    {
      schema: {
        params: baselineParamsSchema
      }
    },
    async (request, reply) => {
      const reviewState = await options.reviewStateUseCase.get({
        baselineId: request.params.baselineId
      });
      return reply.status(200).send(mapRequirementsBaselineToDto(reviewState.baseline!));
    }
  );

  app.post<{
    Params: z.infer<typeof baselineParamsSchema>;
    Body: z.infer<typeof GenerateProjectionRequestDtoSchema>;
  }>(
    '/api/baselines/:baselineId/projections',
    {
      schema: {
        params: baselineParamsSchema,
        body: GenerateProjectionRequestDtoSchema
      }
    },
    async (request, reply) => {
      const result = await options.projectBaselineUseCase.project({
        baselineId: request.params.baselineId,
        artifactType: request.body.artifactType,
        prompt: request.body.prompt
      });

      return reply.status(200).send({
        id: result.projectionId,
        baselineId: result.metadata.baselineId,
        requirementRevisionIds: result.metadata.requirementRevisionIds,
        artifactType: result.metadata.artifactType,
        content: result.content,
        metadata: result.metadata,
        createdAt: result.metadata.measuredVerification.verifiedAt
      });
    }
  );

  app.get<{
    Params: z.infer<typeof baselineParamsSchema>;
  }>(
    '/api/baselines/:baselineId/projections',
    {
      schema: {
        params: baselineParamsSchema
      }
    },
    async (request, reply) => {
      const reviewState = await options.reviewStateUseCase.get({
        baselineId: request.params.baselineId
      });
      return reply.status(200).send(reviewState.projections.map(mapProjectionRecordToDto));
    }
  );

  app.get<{
    Params: z.infer<typeof baselineProjectionParamsSchema>;
  }>(
    '/api/baselines/:baselineId/projections/:projectionId',
    {
      schema: {
        params: baselineProjectionParamsSchema
      }
    },
    async (request, reply) => {
      const projection = await options.projectBaselineUseCase.getProjection(
        request.params.projectionId
      );
      if (!projection || projection.baselineId !== request.params.baselineId) {
        throw new UnknownProjectionError(request.params.projectionId);
      }
      return reply.status(200).send(mapProjectionRecordToDto(projection));
    }
  );
};
