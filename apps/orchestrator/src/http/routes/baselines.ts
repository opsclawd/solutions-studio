import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  CreateRequirementsBaselineRequestDtoSchema,
  GenerateProjectionRequestDtoSchema,
  ListRequirementsBaselinesResponseDtoSchema,
  EngineeringDecisionStateSchema
} from '@solutions-studio/contracts';
import { DomainError } from '@solutions-studio/domain';
import type { CreateRequirementsBaselineUseCase } from '../../application/use-cases/CreateRequirementsBaselineUseCase.js';
import type { ProjectBaselineUseCase } from '../../application/use-cases/ProjectBaselineUseCase.js';
import type { GetRequirementsReviewStateUseCase } from '../../application/use-cases/GetRequirementsReviewStateUseCase.js';
import type { GetAuthorityBundleUseCase } from '../../application/use-cases/GetAuthorityBundleUseCase.js';
import type { RecordEngineeringDecisionUseCase } from '../../application/use-cases/RecordEngineeringDecisionUseCase.js';
import type { GetEngineeringDecisionsUseCase } from '../../application/use-cases/GetEngineeringDecisionsUseCase.js';
import { UnknownProjectionError } from '../../application/use-cases/DiscoveryErrors.js';
import {
  mapRequirementsBaselineToDto,
  mapProjectionRecordToDto,
  mapAuthorityBundleToDto,
  mapEngineeringDecisionToDto
} from '../dto-mappers.js';

export interface BaselinesRoutesOptions {
  readonly baselineUseCase: CreateRequirementsBaselineUseCase;
  readonly projectBaselineUseCase: ProjectBaselineUseCase;
  readonly reviewStateUseCase: GetRequirementsReviewStateUseCase;
  readonly getAuthorityBundleUseCase?: GetAuthorityBundleUseCase;
  readonly recordEngineeringDecisionUseCase?: RecordEngineeringDecisionUseCase;
  readonly getEngineeringDecisionsUseCase?: GetEngineeringDecisionsUseCase;
}

const baselineParamsSchema = z.object({
  baselineId: z.string().min(1)
});

const baselineProjectionParamsSchema = z.object({
  baselineId: z.string().min(1),
  projectionId: z.string().min(1)
});

const createBaselineDecisionBodySchema = z.object({
  id: z.string().min(1).optional(),
  baselineId: z.string().min(1).optional(),
  statement: z.string().min(1),
  rationale: z.string().min(1),
  requirementRevisionIds: z.array(z.string().min(1)).default([]),
  policyConstraintRevisionIds: z.array(z.string().min(1)).default([]),
  createdBy: z.string().min(1),
  supersedes: z.string().min(1).optional()
});

const listDecisionsQuerySchema = z.object({
  state: EngineeringDecisionStateSchema.optional()
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
        policyConstraintRevisionIds: request.body.policyConstraintRevisions,
        createdBy: request.body.createdBy,
        createdAt: request.body.createdAt
      });
      return reply.status(200).send(mapRequirementsBaselineToDto(result));
    }
  );

  app.get(
    '/api/baselines',
    {
      schema: {
        response: {
          200: ListRequirementsBaselinesResponseDtoSchema
        }
      }
    },
    async (_request, reply) => {
      const baselines = await options.reviewStateUseCase.listBaselines();
      return reply.status(200).send(baselines.map(mapRequirementsBaselineToDto));
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
        policyConstraintRevisionIds: result.metadata.policyConstraintRevisionIds,
        engineeringDecisionIds: result.metadata.engineeringDecisionIds,
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
      const baselineScoped = reviewState.projections.filter(
        (p) => p.baselineId === request.params.baselineId
      );
      return reply.status(200).send(baselineScoped.map(mapProjectionRecordToDto));
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

  if (options.getAuthorityBundleUseCase) {
    const getAuthorityBundleUseCase = options.getAuthorityBundleUseCase;
    app.get<{
      Params: z.infer<typeof baselineParamsSchema>;
    }>(
      '/api/baselines/:baselineId/authority-bundle',
      {
        schema: {
          params: baselineParamsSchema
        }
      },
      async (request, reply) => {
        const result = await getAuthorityBundleUseCase.execute({
          baselineId: request.params.baselineId
        });
        return reply.status(200).send(mapAuthorityBundleToDto(result));
      }
    );
  }

  if (options.recordEngineeringDecisionUseCase) {
    const recordEngineeringDecisionUseCase = options.recordEngineeringDecisionUseCase;
    app.post<{
      Params: z.infer<typeof baselineParamsSchema>;
      Body: z.infer<typeof createBaselineDecisionBodySchema>;
    }>(
      '/api/baselines/:baselineId/decisions',
      {
        schema: {
          params: baselineParamsSchema,
          body: createBaselineDecisionBodySchema
        }
      },
      async (request, reply) => {
        const baselineId = request.params.baselineId;
        if (request.body.baselineId && request.body.baselineId !== baselineId) {
          throw new DomainError('Baseline ID in request body does not match route parameter');
        }
        const result = await recordEngineeringDecisionUseCase.execute({
          ...request.body,
          baselineId
        });
        return reply.status(201).send(mapEngineeringDecisionToDto(result));
      }
    );
  }

  if (options.getEngineeringDecisionsUseCase) {
    const getEngineeringDecisionsUseCase = options.getEngineeringDecisionsUseCase;
    app.get<{
      Params: z.infer<typeof baselineParamsSchema>;
      Querystring: z.infer<typeof listDecisionsQuerySchema>;
    }>(
      '/api/baselines/:baselineId/decisions',
      {
        schema: {
          params: baselineParamsSchema,
          querystring: listDecisionsQuerySchema
        }
      },
      async (request, reply) => {
        const result = await getEngineeringDecisionsUseCase.list({
          baselineId: request.params.baselineId,
          state: request.query.state
        });
        return reply.status(200).send(result.map(mapEngineeringDecisionToDto));
      }
    );
  }
};
