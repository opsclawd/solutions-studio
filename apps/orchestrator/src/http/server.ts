import fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { GetRequirementsReviewStateUseCase } from '../application/use-cases/GetRequirementsReviewStateUseCase.js';
import type { ReconcileRequirementsUseCase } from '../application/use-cases/ReconcileRequirementsUseCase.js';
import type { CreateRequirementsBaselineUseCase } from '../application/use-cases/CreateRequirementsBaselineUseCase.js';
import type { ProjectBaselineUseCase } from '../application/use-cases/ProjectBaselineUseCase.js';
import { mapErrorToResponse } from './errorMapper.js';
import { reviewRoutes } from './routes/review.js';
import { requirementsRoutes } from './routes/requirements.js';
import { findingsRoutes } from './routes/findings.js';
import { baselinesRoutes } from './routes/baselines.js';

export interface OrchestratorServerDependencies {
  readonly reviewStateUseCase: GetRequirementsReviewStateUseCase;
  readonly reconcileUseCase: ReconcileRequirementsUseCase;
  readonly baselineUseCase: CreateRequirementsBaselineUseCase;
  readonly projectBaselineUseCase: ProjectBaselineUseCase;
}

export function buildServer(
  deps: OrchestratorServerDependencies,
  options?: FastifyServerOptions
): FastifyInstance {
  const app = fastify(options);

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((error, _request, reply) => {
    const mapped = mapErrorToResponse(error);
    if (mapped.statusCode >= 500) {
      _request.log?.error?.(error);
    }
    return reply.status(mapped.statusCode).send(mapped.body);
  });

  app.get('/api/health', async () => {
    return { status: 'ok' };
  });

  app.register(reviewRoutes, {
    reviewStateUseCase: deps.reviewStateUseCase
  });

  app.register(requirementsRoutes, {
    reconcileUseCase: deps.reconcileUseCase
  });

  app.register(findingsRoutes, {
    reconcileUseCase: deps.reconcileUseCase
  });

  app.register(baselinesRoutes, {
    baselineUseCase: deps.baselineUseCase,
    projectBaselineUseCase: deps.projectBaselineUseCase,
    reviewStateUseCase: deps.reviewStateUseCase
  });

  return app;
}
