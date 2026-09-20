#!/usr/bin/env tsx
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDatabaseClient } from '../src/infrastructure/persistence/postgres/PGliteDatabaseClient.js';
import { SchemaMigrationRunner } from '../src/infrastructure/persistence/postgres/SchemaMigrationRunner.js';
import { PostgresRequirementsRepository } from '../src/infrastructure/persistence/postgres/PostgresRequirementsRepository.js';
import { InMemoryObjectStore } from '../src/infrastructure/persistence/object-store/InMemoryObjectStore.js';
import { composeOrchestratorHttpServer } from '../src/http/composition.js';
import { FakeGenerationGateway } from '../test/fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../test/fakes/FakeMermaidLinterGateway.js';
import { TestAuthenticator } from '../src/infrastructure/identity/TestAuthenticator.js';
import { GenericOidcAuthenticator } from '../src/infrastructure/identity/GenericOidcAuthenticator.js';
import { JwksCache } from '../src/infrastructure/identity/jwksCache.js';
import type { IBacklogExportGateway } from '../src/application/ports/backlog/IBacklogExportGateway.js';
import type { IGenerationGateway } from '../src/application/ports/generation/IGenerationGateway.js';
import { BacklogExportGatewayFactory } from '../src/infrastructure/backlog/BacklogExportGatewayFactory.js';
import { BackupService } from '../src/infrastructure/persistence/backup/BackupService.js';
import {
  RestoreService,
  BackupChecksumMismatchError
} from '../src/infrastructure/persistence/backup/RestoreService.js';
import {
  StructuredOperationalLogger,
  type StructuredLogRecord
} from '../src/infrastructure/observability/StructuredOperationalLogger.js';
import { SensitiveDataSanitizer } from '../src/infrastructure/observability/SensitiveDataSanitizer.js';
import {
  createRequirementRevision,
  createRequirementsBaseline,
  createRequirementId,
  createRequirementRevisionId,
  createRequirementsBaselineId,
  createReviewerId,
  now
} from '@solutions-studio/domain';

interface CheckResult {
  readonly check: string;
  readonly status: 'PASS' | 'FAIL';
  readonly details?: string;
}

async function main() {
  console.log('===========================================================');
  console.log('Solutions Studio: Phase 4.6 Pilot Hardening Validation Drill');
  console.log('===========================================================\n');

  const results: CheckResult[] = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pilot-validation-'));

  const capturedLogs: StructuredLogRecord[] = [];
  StructuredOperationalLogger.setSink((record) => {
    capturedLogs.push(record);
  });

  const pglite = new PGlite();
  const dbClient = new PGliteDatabaseClient({ pgliteInstance: pglite });
  const migrationRunner = new SchemaMigrationRunner({ db: dbClient });
  await migrationRunner.migrate();

  const objectStore = new InMemoryObjectStore();
  const repo = new PostgresRequirementsRepository({
    db: dbClient,
    objectStore
  });

  // Seed baseline and revision for data validation
  const testRev = createRequirementRevision({
    id: createRequirementRevisionId('REQ-PILOT-R1'),
    requirementId: createRequirementId('REQ-PILOT'),
    revision: 1,
    statement: 'The system shall withstand disaster recovery and provide verified rollback.',
    category: 'business-rule',
    origin: 'ASSUMED',
    reviewState: 'ACCEPTED',
    resolutionState: 'CLEAR'
  });
  await repo.saveRequirementRevision(testRev);

  const testBaseline = createRequirementsBaseline({
    id: createRequirementsBaselineId('BL-PILOT-01'),
    requirements: [testRev],
    policyConstraints: [],
    createdBy: createReviewerId('pilot-operator'),
    createdAt: now()
  });
  await repo.saveRequirementsBaseline(testBaseline);

  const healthyBacklogGateway: IBacklogExportGateway = {
    providerId: 'github-issues',
    checkHealth: async () => ({
      status: 'healthy',
      provider: 'github-issues',
      reachable: true,
      latencyMs: 1
    }),
    createWorkItem: async () => ({ externalWorkItemId: '1' }),
    updateWorkItem: async () => ({ externalWorkItemId: '1' })
  };

  let composed = composeOrchestratorHttpServer({
    repository: repo,
    authenticator: new TestAuthenticator(),
    generationGateway: new FakeGenerationGateway(),
    linterGateway: new FakeMermaidLinterGateway(),
    backlogGatewayFactory: new BacklogExportGatewayFactory({
      customGateways: { 'github-issues': healthyBacklogGateway }
    })
  });

  let app = composed.app;
  await app.ready();

  try {
    // -------------------------------------------------------------
    // Check 1: Liveness Endpoint
    // -------------------------------------------------------------
    const liveRes = await app.inject({ method: 'GET', url: '/api/health/live' });
    const liveBody = liveRes.json();
    if (
      liveRes.statusCode === 200 &&
      liveBody.status === 'ok' &&
      typeof liveBody.uptime === 'number' &&
      liveBody.timestamp
    ) {
      results.push({
        check: '1. Liveness Probe (/api/health/live with uptime & timestamp)',
        status: 'PASS'
      });
    } else {
      results.push({
        check: '1. Liveness Probe (/api/health/live with uptime & timestamp)',
        status: 'FAIL',
        details: `Status ${liveRes.statusCode}: ${JSON.stringify(liveBody)}`
      });
    }

    // -------------------------------------------------------------
    // Check 2: Composite Dependency Readiness
    // -------------------------------------------------------------
    const readyRes = await app.inject({ method: 'GET', url: '/api/health/ready' });
    const readyBody = readyRes.json();
    if (
      readyRes.statusCode === 200 &&
      readyBody.status === 'healthy' &&
      readyBody.dependencies?.database?.status === 'healthy' &&
      readyBody.dependencies?.objectStore?.status === 'healthy' &&
      readyBody.dependencies?.identity?.status === 'healthy' &&
      readyBody.dependencies?.generation?.status === 'healthy' &&
      readyBody.dependencies?.backlog?.status === 'healthy'
    ) {
      results.push({ check: '2. Composite Readiness Probe (/api/health/ready)', status: 'PASS' });
    } else {
      results.push({
        check: '2. Composite Readiness Probe (/api/health/ready)',
        status: 'FAIL',
        details: JSON.stringify(readyBody)
      });
    }

    // -------------------------------------------------------------
    // Check 3: Correlation ID Ingress/Egress Tracing
    // -------------------------------------------------------------
    const customCorrelationId = 'c-drill-test-9988';
    const traceRes = await app.inject({
      method: 'GET',
      url: '/api/health/live',
      headers: { 'x-correlation-id': customCorrelationId }
    });
    const echoCorrelation = traceRes.headers['x-correlation-id'];
    if (echoCorrelation === customCorrelationId) {
      results.push({ check: '3. Correlation ID Propagation (X-Correlation-ID)', status: 'PASS' });
    } else {
      results.push({
        check: '3. Correlation ID Propagation (X-Correlation-ID)',
        status: 'FAIL',
        details: `Expected ${customCorrelationId}, got ${echoCorrelation}`
      });
    }

    // -------------------------------------------------------------
    // Check 4: OIDC Unavailability Fail-Closed Invariant
    // -------------------------------------------------------------
    const unreachableJwks = new JwksCache('http://127.0.0.1:9999/unreachable/certs', {
      timeoutMs: 50,
      fetchFn: async () => {
        throw new Error('connect ECONNREFUSED');
      }
    });
    const failingOidcAuth = new GenericOidcAuthenticator({
      issuer: 'http://127.0.0.1:9999/realms/solutions-studio',
      audience: 'solutions-studio-api',
      jwksCache: unreachableJwks
    });
    const oidcDrillServer = composeOrchestratorHttpServer({
      repository: repo,
      authenticator: failingOidcAuth,
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway()
    });
    await oidcDrillServer.app.ready();

    const oidcFailRes = await oidcDrillServer.app.inject({
      method: 'POST',
      url: '/api/baselines',
      headers: {
        authorization: 'Bearer header.payload.dummy',
        'content-type': 'application/json'
      },
      payload: {
        name: 'Attacker Baseline',
        createdBy: 'spoofed-attacker-identity',
        requirementRevisionIds: []
      }
    });

    if (oidcFailRes.statusCode === 401) {
      results.push({
        check: '4. OIDC Degradation Fail-Closed Invariant (Authority Actions Fail Safe with 401)',
        status: 'PASS'
      });
    } else {
      results.push({
        check: '4. OIDC Degradation Fail-Closed Invariant (Authority Actions Fail Safe with 401)',
        status: 'FAIL',
        details: `Got HTTP ${oidcFailRes.statusCode}`
      });
    }
    await oidcDrillServer.app.close();

    // -------------------------------------------------------------
    // Check 5: Backup, Tamper Detection, Successful Restore & Restart
    // -------------------------------------------------------------
    const validBackupDir = path.join(tempDir, 'valid-backup-snap');
    const backupService = new BackupService({
      db: dbClient,
      objectStore,
      targetDir: validBackupDir
    });
    const manifest = await backupService.createBackup();

    // 5A: Cryptographic Tamper Detection
    const corruptBackupDir = path.join(tempDir, 'corrupt-backup-snap');
    await fs.cp(validBackupDir, corruptBackupDir, { recursive: true });
    const baselinesDumpPath = path.join(corruptBackupDir, 'tables', 'baselines.json');
    await fs.writeFile(baselinesDumpPath, 'TAMPERED DATA CORRUPTED');

    const corruptRestoreService = new RestoreService({
      db: dbClient,
      objectStore,
      backupDir: corruptBackupDir,
      repo
    });

    let tamperDetected = false;
    try {
      await corruptRestoreService.restore();
    } catch (err) {
      if (err instanceof BackupChecksumMismatchError) {
        tamperDetected = true;
      }
    }

    if (tamperDetected && manifest.sha256Attestation) {
      results.push({
        check: '5A. Backup & Cryptographic SHA-256 Tamper Detection',
        status: 'PASS'
      });
    } else {
      results.push({
        check: '5A. Backup & Cryptographic SHA-256 Tamper Detection',
        status: 'FAIL',
        details: `Failed to detect corrupted dump. tamperDetected=${tamperDetected}`
      });
    }

    // 5B: Successful Restore & State Integrity Verification
    // Mutate database
    await dbClient.query('DELETE FROM baselines;');
    await dbClient.query('DELETE FROM requirement_revisions;');

    const validRestoreService = new RestoreService({
      db: dbClient,
      objectStore,
      backupDir: validBackupDir,
      repo
    });
    const restoreResult = await validRestoreService.restore();

    const restoredBaseline = await repo.getRequirementsBaseline(testBaseline.id);
    const restoredRev = await repo.getRequirementRevision(testRev.id);

    if (
      restoreResult.verified &&
      restoreResult.checksumsVerified &&
      restoredBaseline?.id === testBaseline.id &&
      restoredRev?.id === testRev.id &&
      restoredRev?.statement === testRev.statement
    ) {
      results.push({
        check: '5B. Successful Database/Blob Restore & State Integrity Verification',
        status: 'PASS'
      });
    } else {
      results.push({
        check: '5B. Successful Database/Blob Restore & State Integrity Verification',
        status: 'FAIL',
        details: `Verified=${restoreResult.verified}, Baseline=${restoredBaseline?.id}, Rev=${restoredRev?.id}`
      });
    }

    // 5C: Process Restart Verification
    await app.close();
    composed = composeOrchestratorHttpServer({
      repository: repo,
      authenticator: new TestAuthenticator(),
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway(),
      backlogGatewayFactory: new BacklogExportGatewayFactory({
        customGateways: { 'github-issues': healthyBacklogGateway }
      })
    });
    app = composed.app;
    await app.ready();

    const restartReady = await app.inject({ method: 'GET', url: '/api/health/ready' });
    if (restartReady.statusCode === 200 && restartReady.json().status === 'healthy') {
      results.push({
        check: '5C. Post-Restore Process Restart & Ready State Verification',
        status: 'PASS'
      });
    } else {
      results.push({
        check: '5C. Post-Restore Process Restart & Ready State Verification',
        status: 'FAIL',
        details: `Post-restart status ${restartReady.statusCode}: ${restartReady.body}`
      });
    }

    // -------------------------------------------------------------
    // Check 6: Degraded Provider Health Scenarios
    // -------------------------------------------------------------
    // 6A: Generation failure -> 503 unhealthy
    const failingGenGateway: IGenerationGateway = {
      generate: async () => ({ text: '' }),
      checkHealth: async () => ({
        status: 'unhealthy',
        provider: 'fake',
        available: false,
        latencyMs: 10,
        error: 'Engine offline'
      })
    };
    const genDegradedServer = composeOrchestratorHttpServer({
      repository: repo,
      authenticator: new TestAuthenticator(),
      generationGateway: failingGenGateway,
      linterGateway: new FakeMermaidLinterGateway(),
      backlogGatewayFactory: new BacklogExportGatewayFactory({
        customGateways: { 'github-issues': healthyBacklogGateway }
      })
    });
    await genDegradedServer.app.ready();
    const genDegradedRes = await genDegradedServer.app.inject({
      method: 'GET',
      url: '/api/health/ready'
    });
    await genDegradedServer.app.close();

    // 6B: Backlog degradation -> 200 degraded
    const degradedBacklogGateway: IBacklogExportGateway = {
      providerId: 'github-issues',
      checkHealth: async () => ({
        status: 'degraded',
        provider: 'github-issues',
        reachable: false,
        latencyMs: 5,
        error: 'Optional provider unconfigured'
      }),
      createWorkItem: async () => ({ externalWorkItemId: '1' }),
      updateWorkItem: async () => ({ externalWorkItemId: '1' })
    };
    const backlogDegradedServer = composeOrchestratorHttpServer({
      repository: repo,
      authenticator: new TestAuthenticator(),
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway(),
      backlogGatewayFactory: new BacklogExportGatewayFactory({
        customGateways: { 'github-issues': degradedBacklogGateway }
      })
    });
    await backlogDegradedServer.app.ready();
    const backlogDegradedRes = await backlogDegradedServer.app.inject({
      method: 'GET',
      url: '/api/health/ready'
    });
    await backlogDegradedServer.app.close();

    if (
      genDegradedRes.statusCode === 503 &&
      genDegradedRes.json().status === 'unhealthy' &&
      backlogDegradedRes.statusCode === 200 &&
      backlogDegradedRes.json().status === 'degraded'
    ) {
      results.push({
        check: '6. Degraded Dependency Health Probes (503 on Gen Outage, 200 Degraded on Backlog)',
        status: 'PASS'
      });
    } else {
      results.push({
        check: '6. Degraded Dependency Health Probes (503 on Gen Outage, 200 Degraded on Backlog)',
        status: 'FAIL',
        details: `Gen=${genDegradedRes.statusCode}, Backlog=${backlogDegradedRes.statusCode}`
      });
    }

    // -------------------------------------------------------------
    // Check 7: Retention Maintenance Scheduling & RBAC Enforcement
    // -------------------------------------------------------------
    const nonAdminMaintRes = await app.inject({
      method: 'POST',
      url: '/api/admin/maintenance/retention',
      headers: { authorization: 'Bearer test:reviewer', 'content-type': 'application/json' },
      payload: { dryRun: true }
    });
    const adminMaintRes = await app.inject({
      method: 'POST',
      url: '/api/admin/maintenance/retention',
      headers: { authorization: 'Bearer test:admin', 'content-type': 'application/json' },
      payload: { dryRun: true }
    });

    if (nonAdminMaintRes.statusCode === 403 && adminMaintRes.statusCode === 200) {
      results.push({
        check: '7. Retention Maintenance Scheduling & RBAC Enforcement',
        status: 'PASS'
      });
    } else {
      results.push({
        check: '7. Retention Maintenance Scheduling & RBAC Enforcement',
        status: 'FAIL',
        details: `Non-admin: ${nonAdminMaintRes.statusCode}, Admin: ${adminMaintRes.statusCode}`
      });
    }

    // -------------------------------------------------------------
    // Check 8: Prometheus Exposition & Metrics Registry
    // -------------------------------------------------------------
    const metricsRes = await app.inject({ method: 'GET', url: '/api/metrics' });
    const summaryRes = await app.inject({ method: 'GET', url: '/api/telemetry/summary' });

    if (
      metricsRes.statusCode === 200 &&
      metricsRes.body.includes('solutions_studio_http_requests_total') &&
      summaryRes.statusCode === 200
    ) {
      results.push({
        check: '8. Metrics Scraping Surface (/api/metrics & /api/telemetry/summary)',
        status: 'PASS'
      });
    } else {
      results.push({
        check: '8. Metrics Scraping Surface (/api/metrics & /api/telemetry/summary)',
        status: 'FAIL',
        details: `Metrics: ${metricsRes.statusCode}`
      });
    }

    // -------------------------------------------------------------
    // Check 9: Adversarial Secret Redaction Invariant
    // -------------------------------------------------------------
    // Send request with confidential query parameters
    await app.inject({
      method: 'GET',
      url: '/api/health/live?token=adversarial-secret-token-12345&password=leaked-pass'
    });

    // Emulate actor authentication with email claim
    StructuredOperationalLogger.log('identity.actor.authenticated', {
      actorId: 'jane.doe@confidential-client.com',
      claims: {
        email: 'jane.doe@confidential-client.com',
        phone: '+1-555-9988'
      }
    });

    // Redact error test
    const errWithSecret = new Error('Database failed at host=db.internal?token=super-secret-12345');
    SensitiveDataSanitizer.sanitizeError(errWithSecret);

    const allLogText = JSON.stringify(capturedLogs);
    const leakedItems = [
      allLogText.includes('adversarial-secret-token-12345') ? 'query-token' : '',
      allLogText.includes('leaked-pass') ? 'password' : '',
      allLogText.includes('jane.doe@confidential-client.com') ? 'email-claim' : '',
      allLogText.includes('super-secret-12345') ? 'super-secret' : ''
    ].filter(Boolean);

    if (leakedItems.length === 0) {
      results.push({
        check: '9. Adversarial Sensitive Data Zero-Leak Invariant (Query params, Emails, Secrets)',
        status: 'PASS'
      });
    } else {
      results.push({
        check: '9. Adversarial Sensitive Data Zero-Leak Invariant (Query params, Emails, Secrets)',
        status: 'FAIL',
        details: `Leaked sensitive items in logs: ${leakedItems.join(', ')}`
      });
    }
  } finally {
    StructuredOperationalLogger.resetSink();
    await app.close();
    await dbClient.close().catch(() => {});
    await pglite.close().catch(() => {});
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }

  console.log('Execution Summary:');
  let hasFailure = false;
  for (const r of results) {
    console.log(`[${r.status}] ${r.check}`);
    if (r.status === 'FAIL') {
      console.log(`       Details: ${r.details}`);
      hasFailure = true;
    }
  }

  if (hasFailure) {
    console.error('\nPilot Hardening Validation: FAILED');
    process.exit(1);
  } else {
    console.log('\nPilot Hardening Validation: ALL CHECKS PASSED');
  }
}

main().catch((err) => {
  console.error('Validation drill crashed:', err);
  process.exit(1);
});
