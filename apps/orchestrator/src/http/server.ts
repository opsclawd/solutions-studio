import fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { AuthenticatedActor } from '@solutions-studio/domain';
import type { GetRequirementsReviewStateUseCase } from '../application/use-cases/GetRequirementsReviewStateUseCase.js';
import type { ReconcileRequirementsUseCase } from '../application/use-cases/ReconcileRequirementsUseCase.js';
import type { CreateRequirementsBaselineUseCase } from '../application/use-cases/CreateRequirementsBaselineUseCase.js';
import type { ProjectBaselineUseCase } from '../application/use-cases/ProjectBaselineUseCase.js';
import type { RecordRequirementsDiscoveryUseCase } from '../application/use-cases/RecordRequirementsDiscoveryUseCase.js';
import type { GetAuthorityBundleUseCase } from '../application/use-cases/GetAuthorityBundleUseCase.js';
import type { RecordEngineeringDecisionUseCase } from '../application/use-cases/RecordEngineeringDecisionUseCase.js';
import type { TransitionEngineeringDecisionUseCase } from '../application/use-cases/TransitionEngineeringDecisionUseCase.js';
import type { GetEngineeringDecisionsUseCase } from '../application/use-cases/GetEngineeringDecisionsUseCase.js';
import type { RecordPolicyConstraintRevisionUseCase } from '../application/use-cases/RecordPolicyConstraintRevisionUseCase.js';
import type { GetPolicyConstraintRevisionUseCase } from '../application/use-cases/GetPolicyConstraintRevisionUseCase.js';
import type { GenerateStoriesProjectionUseCase } from '../application/use-cases/GenerateStoriesProjectionUseCase.js';
import type { GetStoriesUseCase } from '../application/use-cases/GetStoriesUseCase.js';
import type { EvaluateStoryReadinessUseCase } from '../application/use-cases/EvaluateStoryReadinessUseCase.js';
import type { ComputeRequirementCoverageUseCase } from '../application/use-cases/ComputeRequirementCoverageUseCase.js';
import type { BuildStoryDependencyGraphUseCase } from '../application/use-cases/BuildStoryDependencyGraphUseCase.js';
import type { UpdateStoryDependenciesUseCase } from '../application/use-cases/UpdateStoryDependenciesUseCase.js';
import type { GetEngineeringHandoffBundleUseCase } from '../application/use-cases/GetEngineeringHandoffBundleUseCase.js';
import type { IRequirementsRepository } from '../application/ports/persistence/IRequirementsRepository.js';
import type { IAuthenticator } from '../application/ports/identity/IAuthenticator.js';
import type { IAuthorizationPolicy } from '../application/ports/identity/IAuthorizationPolicy.js';
import { mapErrorToResponse } from './errorMapper.js';
import { reviewRoutes } from './routes/review.js';
import { requirementsRoutes } from './routes/requirements.js';
import { findingsRoutes } from './routes/findings.js';
import { baselinesRoutes } from './routes/baselines.js';
import { discoveriesRoutes } from './routes/discoveries.js';
import { policyConstraintsRoutes } from './routes/policy-constraints.js';
import { decisionsRoutes } from './routes/decisions.js';
import { storiesRoutes } from './routes/stories.js';
import { dependencyGraphRoutes } from './routes/dependency-graph.js';
import { handoffRoutes } from './routes/handoff.js';

declare module 'fastify' {
  interface FastifyRequest {
    actor?: AuthenticatedActor;
  }
}

export interface OrchestratorServerDependencies {
  readonly repository?: IRequirementsRepository;
  readonly authenticator?: IAuthenticator;
  readonly authorizer?: IAuthorizationPolicy;
  readonly reviewStateUseCase: GetRequirementsReviewStateUseCase;
  readonly reconcileUseCase: ReconcileRequirementsUseCase;
  readonly baselineUseCase: CreateRequirementsBaselineUseCase;
  readonly projectBaselineUseCase: ProjectBaselineUseCase;
  readonly recordDiscoveryUseCase?: RecordRequirementsDiscoveryUseCase;
  readonly getAuthorityBundleUseCase?: GetAuthorityBundleUseCase;
  readonly recordEngineeringDecisionUseCase?: RecordEngineeringDecisionUseCase;
  readonly transitionEngineeringDecisionUseCase?: TransitionEngineeringDecisionUseCase;
  readonly getEngineeringDecisionsUseCase?: GetEngineeringDecisionsUseCase;
  readonly recordPolicyConstraintRevisionUseCase?: RecordPolicyConstraintRevisionUseCase;
  readonly getPolicyConstraintRevisionUseCase?: GetPolicyConstraintRevisionUseCase;
  readonly generateStoriesProjectionUseCase?: GenerateStoriesProjectionUseCase;
  readonly getStoriesUseCase?: GetStoriesUseCase;
  readonly evaluateStoryReadinessUseCase?: EvaluateStoryReadinessUseCase;
  readonly computeRequirementCoverageUseCase?: ComputeRequirementCoverageUseCase;
  readonly buildStoryDependencyGraphUseCase?: BuildStoryDependencyGraphUseCase;
  readonly updateStoryDependenciesUseCase?: UpdateStoryDependenciesUseCase;
  readonly getEngineeringHandoffBundleUseCase?: GetEngineeringHandoffBundleUseCase;
}

export function buildServer(
  deps: OrchestratorServerDependencies,
  options?: FastifyServerOptions
): FastifyInstance {
  // Ensure logger redacts authorization headers unconditionally (including when options.logger is true or undefined)
  let effectiveLogger: FastifyServerOptions['logger'];
  if (options?.logger === false) {
    effectiveLogger = false;
  } else if (options?.logger === true || options?.logger === undefined) {
    effectiveLogger = {
      redact: ['req.headers.authorization', 'req.headers.Authorization']
    };
  } else if (typeof options?.logger === 'object' && options.logger !== null) {
    effectiveLogger = {
      ...options.logger,
      redact: Array.from(
        new Set([
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...((options.logger as any).redact ?? []),
          'req.headers.authorization',
          'req.headers.Authorization'
        ])
      )
    };
  } else {
    effectiveLogger = options?.logger;
  }

  const app = fastify({
    ...options,
    logger: effectiveLogger
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const rawOrigins = process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN;
  const allowedOrigins = rawOrigins
    ? rawOrigins.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://127.0.0.1:3000'];

  app.register(cors, {
    origin: allowedOrigins,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS']
  });

  app.setErrorHandler((error, _request, reply) => {
    const mapped = mapErrorToResponse(error);
    if (mapped.statusCode >= 500) {
      _request.log?.error?.(error);
    }
    return reply.status(mapped.statusCode).send(mapped.body);
  });

  // Authentication hook
  app.addHook('onRequest', async (request) => {
    if (request.url.startsWith('/api/health')) {
      return;
    }

    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader;

    if (deps.authenticator) {
      const actor = await deps.authenticator.authenticate(token);
      request.actor = actor;
    }
  });

  // Public health endpoints
  app.get('/api/health', async (_request, reply) => {
    if (deps.repository?.checkStorageHealth || deps.repository?.checkHealth) {
      try {
        const checkFn = deps.repository.checkStorageHealth
          ? deps.repository.checkStorageHealth.bind(deps.repository)
          : deps.repository.checkHealth!.bind(deps.repository);
        const report = await checkFn();
        if (report.status === 'unhealthy') {
          return reply.status(503).send(report);
        }
      } catch (err) {
        return reply.status(503).send({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
    return { status: 'ok' };
  });

  app.get('/api/health/live', async () => {
    return { status: 'ok' };
  });

  app.get('/api/health/ready', async (_request, reply) => {
    if (deps.repository?.checkStorageHealth || deps.repository?.checkHealth) {
      try {
        const checkFn = deps.repository.checkStorageHealth
          ? deps.repository.checkStorageHealth.bind(deps.repository)
          : deps.repository.checkHealth!.bind(deps.repository);
        const report = await checkFn();
        const statusCode = report.status === 'healthy' ? 200 : 503;
        return reply.status(statusCode).send(report);
      } catch (err) {
        return reply.status(503).send({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
    return reply.status(200).send({ status: 'healthy', timestamp: new Date().toISOString() });
  });

  // Current authenticated actor endpoint
  app.get('/api/auth/me', async (request, reply) => {
    if (!request.actor) {
      return reply.status(401).send({
        code: 'UNAUTHENTICATED',
        message: 'No authenticated actor'
      });
    }
    return reply.status(200).send({
      id: request.actor.id,
      name: request.actor.name,
      email: request.actor.email,
      actorType: request.actor.actorType,
      capabilities: Array.from(request.actor.capabilities)
    });
  });

  app.register(reviewRoutes, {
    reviewStateUseCase: deps.reviewStateUseCase
  });

  app.register(requirementsRoutes, {
    reconcileUseCase: deps.reconcileUseCase,
    authorizer: deps.authorizer
  });

  app.register(findingsRoutes, {
    reconcileUseCase: deps.reconcileUseCase,
    authorizer: deps.authorizer
  });

  app.register(baselinesRoutes, {
    baselineUseCase: deps.baselineUseCase,
    projectBaselineUseCase: deps.projectBaselineUseCase,
    reviewStateUseCase: deps.reviewStateUseCase,
    getAuthorityBundleUseCase: deps.getAuthorityBundleUseCase,
    recordEngineeringDecisionUseCase: deps.recordEngineeringDecisionUseCase,
    getEngineeringDecisionsUseCase: deps.getEngineeringDecisionsUseCase,
    computeRequirementCoverageUseCase: deps.computeRequirementCoverageUseCase,
    authorizer: deps.authorizer
  });

  if (deps.recordDiscoveryUseCase) {
    app.register(discoveriesRoutes, {
      recordDiscoveryUseCase: deps.recordDiscoveryUseCase,
      authorizer: deps.authorizer
    });
  }

  if (deps.recordPolicyConstraintRevisionUseCase && deps.getPolicyConstraintRevisionUseCase) {
    app.register(policyConstraintsRoutes, {
      recordPolicyConstraintRevisionUseCase: deps.recordPolicyConstraintRevisionUseCase,
      getPolicyConstraintRevisionUseCase: deps.getPolicyConstraintRevisionUseCase,
      authorizer: deps.authorizer
    });
  }

  if (deps.transitionEngineeringDecisionUseCase && deps.getEngineeringDecisionsUseCase) {
    app.register(decisionsRoutes, {
      transitionEngineeringDecisionUseCase: deps.transitionEngineeringDecisionUseCase,
      getEngineeringDecisionsUseCase: deps.getEngineeringDecisionsUseCase,
      authorizer: deps.authorizer
    });
  }

  if (deps.generateStoriesProjectionUseCase && deps.getStoriesUseCase) {
    app.register(storiesRoutes, {
      generateStoriesProjectionUseCase: deps.generateStoriesProjectionUseCase,
      getStoriesUseCase: deps.getStoriesUseCase,
      evaluateStoryReadinessUseCase: deps.evaluateStoryReadinessUseCase,
      updateStoryDependenciesUseCase: deps.updateStoryDependenciesUseCase,
      authorizer: deps.authorizer
    });
  }

  if (deps.buildStoryDependencyGraphUseCase) {
    app.register(dependencyGraphRoutes, {
      buildStoryDependencyGraphUseCase: deps.buildStoryDependencyGraphUseCase
    });
  }

  if (deps.getEngineeringHandoffBundleUseCase) {
    app.register(handoffRoutes, {
      getEngineeringHandoffBundleUseCase: deps.getEngineeringHandoffBundleUseCase,
      authorizer: deps.authorizer
    });
  }

  return app;
}
