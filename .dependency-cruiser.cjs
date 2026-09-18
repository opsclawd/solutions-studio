/**
 * Architectural layer and dependency boundary rules for solutions-studio.
 *
 * Layering architecture:
 *   packages/domain: Pure domain entities, value objects, and domain errors.
 *     - ZERO external npm or node built-in dependencies (pure TypeScript primitives and logic).
 *     - Cannot depend on packages/contracts or apps.
 *
 *   packages/contracts: Transport/DTO contracts, API schemas, and validation.
 *     - May depend on packages/domain and runtime schema libraries (e.g. zod).
 *     - Cannot depend on apps (apps/orchestrator, apps/web).
 *
 *   apps/orchestrator: Backend service / CLI orchestrator.
 *     - src/application: Use cases, application ports, evaluation logic.
 *       MUST NOT depend on src/infrastructure (adapters, gateways, repositories).
 *     - Cannot depend on apps/web.
 *
 *   apps/web: Next.js frontend UI.
 *     - Browser bundle; MUST NOT depend directly on apps/orchestrator backend code.
 *     - Communicates with orchestrator via contracts / network boundaries.
 *
 * Monorepo hygiene:
 *   - No circular dependencies across the entire codebase.
 *   - Production source code cannot import test files or test doubles.
 *
 * Run: pnpm boundaries
 */

module.exports = {
  forbidden: [
    {
      name: 'domain-zero-external-deps',
      severity: 'error',
      comment:
        'packages/domain must have ZERO external runtime/npm dependencies. ' +
        'Keep domain pure with standard TypeScript primitives and pure logic.',
      from: {
        path: '^packages/domain/src'
      },
      to: {
        dependencyTypes: [
          'npm',
          'npm-dev',
          'npm-optional',
          'npm-peer',
          'npm-bundled',
          'npm-unknown',
          'core'
        ]
      }
    },
    {
      name: 'domain-cannot-depend-on-contracts-or-apps',
      severity: 'error',
      comment:
        'packages/domain is the innermost layer and must NOT depend on ' +
        'packages/contracts, apps/orchestrator, or apps/web.',
      from: {
        path: '^packages/domain/src'
      },
      to: {
        path: '^(packages/contracts|apps)'
      }
    },
    {
      name: 'contracts-cannot-depend-on-apps',
      severity: 'error',
      comment:
        'packages/contracts contains transport/DTO schemas only and ' +
        'must NOT depend on apps/orchestrator or apps/web.',
      from: {
        path: '^packages/contracts/src'
      },
      to: {
        path: '^apps'
      }
    },
    {
      name: 'orchestrator-application-cannot-depend-on-infrastructure',
      severity: 'error',
      comment:
        'apps/orchestrator/src/application contains use cases and ports; ' +
        'it MUST NOT import apps/orchestrator/src/infrastructure adapters. ' +
        'Invert dependencies using application ports. (src/application/harness ' +
        'is an integration test harness excluded from this check).',
      from: {
        path: '^apps/orchestrator/src/application',
        pathNot: ['^apps/orchestrator/src/application/harness/']
      },
      to: {
        path: '^apps/orchestrator/src/infrastructure'
      }
    },
    {
      name: 'orchestrator-cannot-depend-on-web',
      severity: 'error',
      comment: 'apps/orchestrator must NOT depend on apps/web.',
      from: {
        path: '^apps/orchestrator'
      },
      to: {
        path: '^apps/web'
      }
    },
    {
      name: 'web-cannot-depend-on-orchestrator',
      severity: 'error',
      comment:
        'apps/web is the frontend UI and must communicate with backend services ' +
        'via API contracts or network endpoints, never by importing apps/orchestrator directly.',
      from: {
        path: '^apps/web'
      },
      to: {
        path: '^apps/orchestrator'
      }
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies are forbidden.',
      from: {},
      to: {
        circular: true
      }
    },
    {
      name: 'no-test-imports-from-non-test',
      severity: 'error',
      comment: 'Production code must not import test files or test fixtures.',
      from: {
        pathNot: '(^|/)(test|__tests__|scripts)/'
      },
      to: {
        path: '(^|/)(test|__tests__)/'
      }
    }
  ],
  options: {
    doNotFollow: {
      path: 'node_modules'
    },
    exclude: {
      path: '(^|/)(node_modules|dist|coverage|\\.next|\\.ai-runs|\\.ai-worktrees|\\.ai-tmp|ai|\\.claude|\\.context|\\.review-context|\\.antigravitycli|cache|test-results|changes|review-reports)/|\\.timestamp-\\d+-[a-z0-9]+\\.mjs$'
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.base.json'
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['development', 'import', 'require', 'node', 'default', 'types'],
      mainFields: ['main', 'types']
    },
    reporterOptions: {
      text: {
        highlightFocused: true
      }
    }
  }
};
