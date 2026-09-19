import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  GenerateStoryRequestDtoSchema,
  StoryDtoSchema,
  ListStoriesResponseDtoSchema
} from '@solutions-studio/contracts';
import type { GenerateStoriesProjectionUseCase } from '../../application/use-cases/GenerateStoriesProjectionUseCase.js';
import type { GetStoriesUseCase } from '../../application/use-cases/GetStoriesUseCase.js';
import { UnknownStoryError } from '../../application/use-cases/StoryProjectionErrors.js';
import { mapStoryRecordToDto } from '../dto-mappers.js';

export interface StoriesRoutesOptions {
  readonly generateStoriesProjectionUseCase: GenerateStoriesProjectionUseCase;
  readonly getStoriesUseCase: GetStoriesUseCase;
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
};
