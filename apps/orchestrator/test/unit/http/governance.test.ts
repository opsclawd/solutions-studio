import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { FastifyInstance } from 'fastify';
import { composeOrchestratorHttpServer } from '../../../src/http/composition.js';

describe('Governance HTTP Routes API', () => {
  let tmpDir: string;
  let app: FastifyInstance;
  const candidateSha = 'd5adf81ac2ba5acd7b7cd22c830f03e2258a63b4';
  const artifactHash = 'a'.repeat(64);

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gov-http-test-'));
    const composed = composeOrchestratorHttpServer({
      storeDir: tmpDir,
      fastifyOptions: { logger: false }
    });
    app = composed.app;
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function recordRun(runSha = candidateSha) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/governance/validation-runs',
      payload: {
        candidateSha: runSha,
        phase: 'phase-3',
        executionMode: 'deterministic-ci',
        provider: 'fake',
        artifacts: [
          {
            name: 'schema.sql',
            artifactType: 'sql-ddl',
            contentHash: artifactHash
          }
        ],
        proposedDisposition: 'GO',
        summary: { checks: 15 }
      }
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  it('records validation run and retrieves it by ID', async () => {
    const run = await recordRun();
    expect(run.id).toBeDefined();
    expect(run.candidateSha).toBe(candidateSha);
    expect(run.executedBy).toBe('anonymous:runner');

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/governance/validation-runs/${run.id}`
    });
    expect(getRes.statusCode).toBe(200);
    const fetched = getRes.json();
    expect(fetched.id).toBe(run.id);
    expect(fetched.evidenceDigest).toBe(run.evidenceDigest);
  });

  it('rejects validation run when artifact content does not match contentHash', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/governance/validation-runs',
      payload: {
        candidateSha,
        phase: 'phase-3',
        executionMode: 'deterministic-ci',
        provider: 'fake',
        artifacts: [
          {
            name: 'schema.sql',
            artifactType: 'sql-ddl',
            contentHash: 'b'.repeat(64),
            content: 'CREATE TABLE orders (id INT);'
          }
        ]
      }
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects validation run with empty evidence artifacts (HTTP 400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/governance/validation-runs',
      payload: {
        candidateSha,
        phase: 'phase-3',
        executionMode: 'deterministic-ci',
        provider: 'fake',
        artifacts: []
      }
    });
    expect(res.statusCode).toBe(400);
  });

  it('evaluates candidate status to UNAPPROVED when no approval exists', async () => {
    await recordRun();

    const res = await app.inject({
      method: 'GET',
      url: `/api/governance/candidates/${candidateSha}/status`
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.isApproved).toBe(false);
    expect(body.disposition).toBe('UNAPPROVED');
    expect(body.diagnosticCode).toBe('AWAITING_APPROVAL');
  });

  it('rejects approval creation when unauthenticated (HTTP 401)', async () => {
    const run = await recordRun();

    const res = await app.inject({
      method: 'POST',
      url: '/api/governance/approvals',
      payload: {
        candidateSha,
        validationRunId: run.id,
        evidenceDigest: run.evidenceDigest,
        decision: 'GO',
        rationale: 'Looks good'
      }
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects approval creation when actor is automated agent (HTTP 403 HUMAN_ACTOR_REQUIRED)', async () => {
    const run = await recordRun();

    // TestAuthenticator maps token 'test:agent' to an agent actor
    const res = await app.inject({
      method: 'POST',
      url: '/api/governance/approvals',
      headers: {
        authorization: 'Bearer test:agent'
      },
      payload: {
        candidateSha,
        validationRunId: run.id,
        evidenceDigest: run.evidenceDigest,
        decision: 'GO',
        rationale: 'Automated agent simulated GO'
      }
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.code).toBe('HUMAN_ACTOR_REQUIRED');
  });

  it('rejects approval creation when human actor lacks candidate:approve (HTTP 403 FORBIDDEN)', async () => {
    const run = await recordRun();

    // TestAuthenticator maps token 'test:viewer' to a human without candidate:approve
    const res = await app.inject({
      method: 'POST',
      url: '/api/governance/approvals',
      headers: {
        authorization: 'Bearer test:viewer'
      },
      payload: {
        candidateSha,
        validationRunId: run.id,
        evidenceDigest: run.evidenceDigest,
        decision: 'GO',
        rationale: 'Review by contributor'
      }
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.code).toBe('FORBIDDEN');
  });

  it('creates active approval when authenticated as human reviewer with candidate:approve', async () => {
    const run = await recordRun();

    // TestAuthenticator maps 'test:reviewer' or 'test:admin' to human reviewer with candidate:approve
    const res = await app.inject({
      method: 'POST',
      url: '/api/governance/approvals',
      headers: {
        authorization: 'Bearer test:reviewer'
      },
      payload: {
        candidateSha,
        validationRunId: run.id,
        evidenceDigest: run.evidenceDigest,
        decision: 'GO',
        rationale: 'Verified all 15 steps passed cleanly.'
      }
    });

    expect(res.statusCode).toBe(201);
    const approval = res.json();
    expect(approval.status).toBe('ACTIVE');
    expect(approval.decision).toBe('GO');
    expect(approval.actor.actorType).toBe('human');

    // Promotion status should now be APPROVED
    const statusRes = await app.inject({
      method: 'GET',
      url: `/api/governance/candidates/${candidateSha}/status`
    });
    expect(statusRes.statusCode).toBe(200);
    const statusBody = statusRes.json();
    expect(statusBody.isApproved).toBe(true);
    expect(statusBody.disposition).toBe('APPROVED');
    expect(statusBody.diagnosticCode).toBe('PROMOTION_READY');
  });

  it('revokes an approval and verifies promotion status transitions to UNAPPROVED', async () => {
    const run = await recordRun();

    const approvalRes = await app.inject({
      method: 'POST',
      url: '/api/governance/approvals',
      headers: {
        authorization: 'Bearer test:reviewer'
      },
      payload: {
        candidateSha,
        validationRunId: run.id,
        evidenceDigest: run.evidenceDigest,
        decision: 'GO',
        rationale: 'Initially approved'
      }
    });
    const approval = approvalRes.json();

    const revokeRes = await app.inject({
      method: 'POST',
      url: `/api/governance/approvals/${approval.id}/revoke`,
      headers: {
        authorization: 'Bearer test:reviewer'
      },
      payload: {
        rationale: 'Discovered security bug post-approval'
      }
    });
    expect(revokeRes.statusCode).toBe(200);
    const revoked = revokeRes.json();
    expect(revoked.status).toBe('REVOKED');
    expect(revoked.revocation.rationale).toBe('Discovered security bug post-approval');

    // Promotion status should now be UNAPPROVED with APPROVAL_REVOKED
    const statusRes = await app.inject({
      method: 'GET',
      url: `/api/governance/candidates/${candidateSha}/status`
    });
    expect(statusRes.statusCode).toBe(200);
    const statusBody = statusRes.json();
    expect(statusBody.isApproved).toBe(false);
    expect(statusBody.diagnosticCode).toBe('APPROVAL_REVOKED');
  });

  it('exports complete governance audit package with valid manifest checksum', async () => {
    const run = await recordRun();

    await app.inject({
      method: 'POST',
      url: '/api/governance/approvals',
      headers: {
        authorization: 'Bearer test:reviewer'
      },
      payload: {
        candidateSha,
        validationRunId: run.id,
        evidenceDigest: run.evidenceDigest,
        decision: 'GO',
        rationale: 'Audit package test'
      }
    });

    const exportRes = await app.inject({
      method: 'GET',
      url: `/api/governance/audit/export?candidateSha=${candidateSha}`
    });
    expect(exportRes.statusCode).toBe(200);
    const exportData = exportRes.json();
    expect(exportData.candidateSha).toBe(candidateSha);
    expect(exportData.promotionStatus.isApproved).toBe(true);
    expect(exportData.validationRuns.length).toBeGreaterThanOrEqual(1);
    expect(exportData.approvalHistory.length).toBeGreaterThanOrEqual(1);
    expect(exportData.manifestChecksum).toMatch(/^[a-f0-9]{64}$/);
  });
});
