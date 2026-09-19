import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  GenerateStoryRequestDtoSchema,
  StoryDtoSchema,
  ListStoriesResponseDtoSchema,
  StoryReadinessPolicyDtoSchema,
  StoryReadinessReportDtoSchema,
  ListStoryReadinessReportsResponseDtoSchema,
  UpdateStoryDependenciesRequestDtoSchema
} from '@solutions-studio/contracts';
import type { GenerateStoriesProjectionUseCase } from '../../application/use-cases/GenerateStoriesProjectionUseCase.js';
import type { GetStoriesUseCase } from '../../application/use-cases/GetStoriesUseCase.js';
import type { EvaluateStoryReadinessUseCase } from '../../application/use-cases/EvaluateStoryReadinessUseCase.js';
import type { UpdateStoryDependenciesUseCase } from '../../application/use-cases/UpdateStoryDependenciesUseCase.js';
import { UnknownStoryError } from '../../application/use-cases/StoryProjectionErrors.js';
import { mapStoryRecordToDto, mapStoryReadinessReportToDto } from '../dto-mappers.js';

export interface StoriesRoutesOptions {
  readonly generateStoriesProjectionUseCase: GenerateStoriesProjectionUseCase;
  readonly getStoriesUseCase: GetStoriesUseCase;
  readonly evaluateStoryReadinessUseCase?: EvaluateStoryReadinessUseCase;
  readonly updateStoryDependenciesUseCase?: UpdateStoryDependenciesUseCase;
}

const baselineParamsSchema = z.object({
  baselineId: z.string().min(1)
});

const storyParamsSchema = z.object({
  storyId: z.string().min(1)
});

export const storiesRoutes: FastifyPluginAsync<StoriesRoutesOptions> = async (app, options) => {
  app.post<{
    Params: z.infer<typeof baselineParamsSchema>;
    Body: z.infer<typeof GenerateStoryRequestDtoSchema>;
  }>(
    '/api/baselines/:baselineId/stories',
    {
      schema: {
        params: baselineParamsSchema,
        body: GenerateStoryRequestDtoSchema,
        response: {
          201: StoryDtoSchema
        }
      }
    },
    async (request, reply) => {
      const result = await options.generateStoriesProjectionUseCase.execute({
        baselineId: request.params.baselineId,
        prompt: request.body?.prompt,
        id: request.body?.id,
        autoRecordDiscoveries: request.body?.autoRecordDiscoveries
      });
      return reply.status(201).send(mapStoryRecordToDto(result.story));
    }
  );

  app.get<{
    Params: z.infer<typeof baselineParamsSchema>;
  }>(
    '/api/baselines/:baselineId/stories',
    {
      schema: {
        params: baselineParamsSchema,
        response: {
          200: ListStoriesResponseDtoSchema
        }
      }
    },
    async (request, reply) => {
      const stories = await options.getStoriesUseCase.listStories(request.params.baselineId);
      return reply.status(200).send(stories.map(mapStoryRecordToDto));
    }
  );

  app.get<{
    Params: z.infer<typeof storyParamsSchema>;
  }>(
    '/api/stories/:storyId',
    {
      schema: {
        params: storyParamsSchema,
        response: {
          200: StoryDtoSchema
        }
      }
    },
    async (request, reply) => {
      const story = await options.getStoriesUseCase.getStory(request.params.storyId);
      if (!story) {
        throw new UnknownStoryError(request.params.storyId);
      }
      return reply.status(200).send(mapStoryRecordToDto(story));
    }
  );

  if (options.evaluateStoryReadinessUseCase) {
    const evaluateStoryReadinessUseCase = options.evaluateStoryReadinessUseCase;

    const readinessQuerySchema = z.object({
      requireSqlProjection: z
        .union([z.boolean(), z.enum(['true', 'false'])])
        .transform((val) => val === true || val === 'true')
        .optional(),
      requireOpenApiProjection: z
        .union([z.boolean(), z.enum(['true', 'false'])])
        .transform((val) => val === true || val === 'true')
        .optional(),
      allowDeferredEngineeringDecisions: z
        .union([z.boolean(), z.enum(['true', 'false'])])
        .transform((val) => val === true || val === 'true')
        .optional()
    });

    app.get<{
      Params: z.infer<typeof storyParamsSchema>;
      Querystring: z.infer<typeof readinessQuerySchema>;
    }>(
      '/api/stories/:storyId/readiness',
      {
        schema: {
          params: storyParamsSchema,
          querystring: readinessQuerySchema,
          response: {
            200: StoryReadinessReportDtoSchema
          }
        }
      },
      async (request, reply) => {
        const report = await evaluateStoryReadinessUseCase.execute({
          storyId: request.params.storyId,
          policy: request.query
        });
        return reply.status(200).send(mapStoryReadinessReportToDto(report));
      }
    );

    app.post<{
      Params: z.infer<typeof storyParamsSchema>;
      Body: z.infer<typeof StoryReadinessPolicyDtoSchema>;
    }>(
      '/api/stories/:storyId/readiness',
      {
        schema: {
          params: storyParamsSchema,
          body: StoryReadinessPolicyDtoSchema.optional(),
          response: {
            200: StoryReadinessReportDtoSchema
          }
        }
      },
      async (request, reply) => {
        const report = await evaluateStoryReadinessUseCase.execute({
          storyId: request.params.storyId,
          policy: request.body
        });
        return reply.status(200).send(mapStoryReadinessReportToDto(report));
      }
    );

    app.get<{
      Params: z.infer<typeof baselineParamsSchema>;
      Querystring: z.infer<typeof readinessQuerySchema>;
    }>(
      '/api/baselines/:baselineId/stories/readiness',
      {
        schema: {
          params: baselineParamsSchema,
          querystring: readinessQuerySchema,
          response: {
            200: ListStoryReadinessReportsResponseDtoSchema
          }
        }
      },
      async (request, reply) => {
        const reports = await evaluateStoryReadinessUseCase.executeForBaseline(
          request.params.baselineId,
          request.query
        );
        return reply.status(200).send(reports.map(mapStoryReadinessReportToDto));
      }
    );
  }

  if (options.updateStoryDependenciesUseCase) {
    const updateStoryDependenciesUseCase = options.updateStoryDependenciesUseCase;
    app.put<{
      Params: z.infer<typeof storyParamsSchema>;
      Body: z.infer<typeof UpdateStoryDependenciesRequestDtoSchema>;
    }>(
      '/api/stories/:storyId/dependencies',
      {
        schema: {
          params: storyParamsSchema,
          body: UpdateStoryDependenciesRequestDtoSchema,
          response: {
            200: StoryDtoSchema
          }
        }
      },
      async (request, reply) => {
        const updated = await updateStoryDependenciesUseCase.execute({
          storyId: request.params.storyId,
          dependencies: request.body.dependencies
        });
        return reply.status(200).send(mapStoryRecordToDto(updated));
      }
    );
  }
};
