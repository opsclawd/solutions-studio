import fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { AuthenticatedActor } from '@solutions-studio/domain';
import type {
  ITelemetryRegistry,
  IOperationalLogger
} from '../application/ports/observability/index.js';
import type { PruneRetentionUseCase } from '../application/use-cases/PruneRetentionUseCase.js';
import { observabilityRoutes } from './routes/observability.js';
import { maintenanceRoutes } from './routes/maintenance.js';
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
import { governanceRoutes } from './routes/governance.js';
import type { ExportBacklogUseCase } from '../application/use-cases/ExportBacklogUseCase.js';
import type { EvaluateExportStalenessUseCase } from '../application/use-cases/EvaluateExportStalenessUseCase.js';
import type { GetBacklogExportMappingsUseCase } from '../application/use-cases/GetBacklogExportMappingsUseCase.js';
import { backlogRoutes } from './routes/backlog.js';
import type { RecordValidationRunUseCase } from '../application/use-cases/governance/RecordValidationRunUseCase.js';
import type { ApproveCandidateUseCase } from '../application/use-cases/governance/ApproveCandidateUseCase.js';
import type { EvaluateCandidatePromotionStatusUseCase } from '../application/use-cases/governance/EvaluateCandidatePromotionStatusUseCase.js';
import type { RevokeGovernanceApprovalUseCase } from '../application/use-cases/governance/RevokeGovernanceApprovalUseCase.js';
import type { ExportGovernanceAuditUseCase } from '../application/use-cases/governance/ExportGovernanceAuditUseCase.js';
import type { IGenerationGateway } from '../application/ports/generation/IGenerationGateway.js';
import type { IBacklogExportGateway } from '../application/ports/backlog/IBacklogExportGateway.js';
import { CorrelationContext } from '../application/ports/observability/CorrelationContext.js';

declare module 'fastify' {
  interface FastifyRequest {
    actor?: AuthenticatedActor;
    correlationId?: string;
  }
}

export interface OrchestratorServerDependencies {
  readonly repository?: IRequirementsRepository;
  readonly authenticator?: IAuthenticator;
  readonly authorizer?: IAuthorizationPolicy;
  readonly telemetryRegistry?: ITelemetryRegistry;
  readonly operationalLogger?: IOperationalLogger;
  readonly pruneRetentionUseCase?: PruneRetentionUseCase;
  readonly generationGateway?: IGenerationGateway;
  readonly backlogExportGateway?: IBacklogExportGateway;
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
  readonly recordValidationRunUseCase?: RecordValidationRunUseCase;
  readonly approveCandidateUseCase?: ApproveCandidateUseCase;
  readonly evaluateCandidatePromotionStatusUseCase?: EvaluateCandidatePromotionStatusUseCase;
  readonly revokeGovernanceApprovalUseCase?: RevokeGovernanceApprovalUseCase;
  readonly exportGovernanceAuditUseCase?: ExportGovernanceAuditUseCase;
  readonly exportBacklogUseCase?: ExportBacklogUseCase;
  readonly evaluateExportStalenessUseCase?: EvaluateExportStalenessUseCase;
  readonly getBacklogExportMappingsUseCase?: GetBacklogExportMappingsUseCase;
}

export function buildServer(
  deps: OrchestratorServerDependencies,
  options?: FastifyServerOptions
): FastifyInstance {
  // Ensure logger redacts authorization headers unconditionally (including when options.logger is true or undefined)
  const defaultRedact = [
    'req.headers.authorization',
    'req.headers.Authorization',
    'req.headers.cookie',
    'req.headers["x-api-key"]'
  ];
  const defaultSerializers = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    req(req: any) {
      const rawUrl = req.raw?.url ?? req.url ?? '';
      const pathname = rawUrl.split('?')[0];
      return {
        method: req.method,
        url: pathname,
        version: req.headers?.['accept-version'],
        host: req.headers?.host,
        remoteAddress: req.socket?.remoteAddress
      };
    }
  };

  let effectiveLogger: FastifyServerOptions['logger'];
  if (options?.logger === false) {
    effectiveLogger = false;
  } else if (options?.logger === true || options?.logger === undefined) {
    effectiveLogger = {
      redact: defaultRedact,
      serializers: defaultSerializers
    };
  } else if (typeof options?.logger === 'object' && options.logger !== null) {
    effectiveLogger = {
      ...options.logger,
      redact: Array.from(
        new Set([
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...((options.logger as any).redact ?? []),
          ...defaultRedact
        ])
      ),
      serializers: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...((options.logger as any).serializers ?? {}),
        ...defaultSerializers
      }
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

  // Correlation ID extraction & propagation hook
  app.addHook('onRequest', (request, reply, done) => {
    const incomingCorrelation = (request.headers['x-correlation-id'] ??
      request.headers['x-request-id']) as string | undefined;
    const correlationId = incomingCorrelation?.trim() || CorrelationContext.generateCorrelationId();
    request.correlationId = correlationId;

    CorrelationContext.run(correlationId, () => {
      done();
    });
  });

  // Correlation ID header injection hook
  app.addHook('onSend', async (request, reply) => {
    if (request.correlationId) {
      reply.header('x-correlation-id', request.correlationId);
      reply.header('X-Correlation-ID', request.correlationId);
    }
  });

  // Request completion logging & telemetry hook
  app.addHook('onResponse', async (request, reply) => {
    const durationMs = Math.round(reply.elapsedTime);
    const safeUrl = request.routeOptions?.url ?? request.url.split('?')[0];

    deps.operationalLogger?.log(
      'http.request.completed',
      {
        method: request.method,
        url: safeUrl,
        statusCode: reply.statusCode,
        durationMs
      },
      {
        correlationId: request.correlationId,
        actorId: request.actor?.id
      }
    );

    if (deps.telemetryRegistry) {
      const route = request.routeOptions?.url ?? 'unmatched';
      deps.telemetryRegistry.incrementCounter('solutions_studio_http_requests_total', {
        method: request.method,
        route,
        status_code: reply.statusCode
      });
      deps.telemetryRegistry.observeHistogram(
        'solutions_studio_http_request_duration_ms',
        durationMs,
        {
          method: request.method,
          route
        }
      );
    }
  });

  // Authentication hook
  app.addHook('onRequest', async (request) => {
    if (
      request.url.startsWith('/api/health') ||
      request.url.startsWith('/api/metrics') ||
      request.url.startsWith('/api/telemetry')
    ) {
      return;
    }

    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader;

    if (deps.authenticator) {
      try {
        const actor = await deps.authenticator.authenticate(token);
        request.actor = actor;
        CorrelationContext.setActorId(actor.id);

        const capsCount = actor.capabilities
          ? Array.isArray(actor.capabilities)
            ? actor.capabilities.length
            : (actor.capabilities as Set<string>).size
          : 0;

        deps.operationalLogger?.log(
          'identity.actor.authenticated',
          {
            actorId: actor.id,
            actorType: actor.actorType,
            capabilitiesCount: capsCount
          },
          {
            correlationId: request.correlationId,
            actorId: actor.id
          }
        );
      } catch (authErr) {
        if (deps.telemetryRegistry) {
          const reason =
            authErr && typeof authErr === 'object' && 'reason' in authErr
              ? String((authErr as { reason: unknown }).reason)
              : 'UNAUTHENTICATED';
          deps.telemetryRegistry.incrementCounter('solutions_studio_auth_failures_total', {
            reason
          });
        }
        throw authErr;
      }
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
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
  });

  app.get('/api/health/ready', async (_request, reply) => {
    let storageReport: Record<string, unknown> | undefined = undefined;
    let isStorageHealthy = true;

    if (deps.repository?.checkStorageHealth || deps.repository?.checkHealth) {
      try {
        const checkFn = deps.repository.checkStorageHealth
          ? deps.repository.checkStorageHealth.bind(deps.repository)
          : deps.repository.checkHealth!.bind(deps.repository);
        const report = await checkFn();
        storageReport = report as unknown as Record<string, unknown>;
        if (report.status === 'unhealthy') {
          isStorageHealthy = false;
        }
      } catch (err) {
        isStorageHealthy = false;
        storageReport = {
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: err instanceof Error ? err.message : String(err)
        };
      }
    }

    let identityReport: Record<string, unknown> | undefined = undefined;
    let isIdentityHealthy = true;

    if (deps.authenticator?.checkHealth) {
      try {
        const report = await deps.authenticator.checkHealth();
        identityReport = report as unknown as Record<string, unknown>;
        if (report.status === 'unhealthy') {
          isIdentityHealthy = false;
        }
      } catch (err) {
        isIdentityHealthy = false;
        identityReport = {
          status: 'unhealthy',
          provider: 'unknown',
          reachable: false,
          error: err instanceof Error ? err.message : String(err)
        };
      }
    }

    let generationReport: Record<string, unknown> | undefined = undefined;
    let isGenerationHealthy = true;

    if (deps.generationGateway?.checkHealth) {
      try {
        const report = await deps.generationGateway.checkHealth();
        generationReport = report as unknown as Record<string, unknown>;
        if (report.status === 'unhealthy') {
          isGenerationHealthy = false;
        }
      } catch (err) {
        isGenerationHealthy = false;
        generationReport = {
          status: 'unhealthy',
          provider: 'unknown',
          available: false,
          error: err instanceof Error ? err.message : String(err)
        };
      }
    } else {
      const generationProvider = process.env.GENERATION_PROVIDER ?? 'fake';
      const available = generationProvider === 'fake' || generationProvider === 'fixture-replay';
      generationReport = {
        status: available ? 'healthy' : 'unhealthy',
        provider: generationProvider,
        available,
        ...(available
          ? {}
          : { error: `Generation provider '${generationProvider}' requires runtime CLI check` })
      };
      if (!available) {
        isGenerationHealthy = false;
      }
    }

    let backlogReport: Record<string, unknown> | undefined = undefined;
    let isBacklogDegraded = false;

    if (deps.backlogExportGateway?.checkHealth) {
      try {
        const report = await deps.backlogExportGateway.checkHealth();
        backlogReport = report as unknown as Record<string, unknown>;
        if (report.status === 'unhealthy') {
          isBacklogDegraded = true;
        } else if (report.status === 'degraded' || report.status === 'unconfigured') {
          isBacklogDegraded = true;
        }
      } catch (err) {
        isBacklogDegraded = true;
        backlogReport = {
          status: 'unhealthy',
          provider: 'github-issues',
          reachable: false,
          error: err instanceof Error ? err.message : String(err)
        };
      }
    } else {
      const hasToken = Boolean(process.env.GITHUB_TOKEN);
      backlogReport = {
        status: hasToken ? 'healthy' : 'degraded',
        provider: 'github-issues',
        reachable: hasToken,
        ...(hasToken ? {} : { error: 'Unconfigured: GITHUB_TOKEN not set' })
      };
      if (!hasToken) {
        isBacklogDegraded = true;
      }
    }

    // Storage, Identity, and Generation are critical dependencies
    const isCriticalHealthy = isStorageHealthy && isIdentityHealthy && isGenerationHealthy;
    const overallStatus = !isCriticalHealthy
      ? 'unhealthy'
      : isBacklogDegraded
        ? 'degraded'
        : 'healthy';
    const statusCode = isCriticalHealthy ? 200 : 503;

    const responseBody = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '0.1.0',
      database: storageReport?.database,
      objectStore: storageReport?.objectStore,
      identity: identityReport,
      generation: generationReport,
      backlog: backlogReport,
      dependencies: {
        database: storageReport?.database,
        objectStore: storageReport?.objectStore,
        identity: identityReport,
        generation: generationReport,
        backlog: backlogReport
      }
    };

    return reply.status(statusCode).send(responseBody);
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

  if (
    deps.repository &&
    deps.recordValidationRunUseCase &&
    deps.approveCandidateUseCase &&
    deps.evaluateCandidatePromotionStatusUseCase &&
    deps.revokeGovernanceApprovalUseCase &&
    deps.exportGovernanceAuditUseCase
  ) {
    app.register(governanceRoutes, {
      repository: deps.repository,
      recordRunUseCase: deps.recordValidationRunUseCase,
      approveUseCase: deps.approveCandidateUseCase,
      evaluateStatusUseCase: deps.evaluateCandidatePromotionStatusUseCase,
      revokeUseCase: deps.revokeGovernanceApprovalUseCase,
      exportUseCase: deps.exportGovernanceAuditUseCase
    });
  }

  if (
    deps.exportBacklogUseCase &&
    deps.evaluateExportStalenessUseCase &&
    deps.getBacklogExportMappingsUseCase
  ) {
    app.register(backlogRoutes, {
      exportBacklogUseCase: deps.exportBacklogUseCase,
      evaluateExportStalenessUseCase: deps.evaluateExportStalenessUseCase,
      getBacklogExportMappingsUseCase: deps.getBacklogExportMappingsUseCase,
      authorizer: deps.authorizer
    });
  }

  if (deps.telemetryRegistry) {
    app.register(observabilityRoutes, {
      telemetryRegistry: deps.telemetryRegistry
    });
  }

  if (deps.pruneRetentionUseCase) {
    app.register(maintenanceRoutes, {
      pruneRetentionUseCase: deps.pruneRetentionUseCase
    });
  }

  return app;
}
