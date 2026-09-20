import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { PolicyConstraintRevisionDtoSchema } from '@solutions-studio/contracts';
import { FilesystemRequirementsRepository } from '../../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeGenerationGateway } from '../../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../../fakes/FakeMermaidLinterGateway.js';
import { composeOrchestratorHttpServer } from '../../../src/http/composition.js';

describe('HTTP Boundary: Policy Constraints API', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let app: FastifyInstance;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'http-policy-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    const composed = composeOrchestratorHttpServer({
      repository: repo,
      generationGateway: new FakeGenerationGateway(),
      linterGateway: new FakeMermaidLinterGateway()
    });
    app = composed.app;
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('POST /api/policy-constraints', () => {
    it('creates a policy constraint revision and returns 201 with DTO', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/policy-constraints',
        payload: {
          policyConstraintId: 'PC-SEC-001',
          statement: 'All network traffic must be encrypted with TLS 1.3.',
          authorityReference: 'NIST SP 800-52 Rev 2',
          state: 'ACCEPTED',
          createdBy: 'sec-lead'
        }
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      const validated = PolicyConstraintRevisionDtoSchema.parse(body);
      expect(validated.policyConstraintId).toBe('PC-SEC-001');
      expect(validated.revision).toBe(1);
      expect(validated.id).toBe('PC-SEC-001@r1');
      expect(validated.state).toBe('ACCEPTED');
      expect(validated.authorityReference).toBe('NIST SP 800-52 Rev 2');
      expect(validated.createdBy).toBe('sec-lead');
    });

    it('creates successor revision with supersedes link', async () => {
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/policy-constraints',
        payload: {
          policyConstraintId: 'PC-SEC-002',
          statement: 'Initial security rule',
          authorityReference: 'REF-1',
          state: 'PENDING',
          createdBy: 'sec-analyst'
        }
      });
      expect(res1.statusCode).toBe(201);
      const rev1 = res1.json();

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/policy-constraints',
        payload: {
          policyConstraintId: 'PC-SEC-002',
          statement: 'Updated security rule',
          authorityReference: 'REF-2',
          state: 'ACCEPTED',
          createdBy: 'sec-lead',
          supersedes: rev1.id
        }
      });
      expect(res2.statusCode).toBe(201);
      const rev2 = res2.json();
      expect(rev2.revision).toBe(2);
      expect(rev2.supersedes).toBe(rev1.id);
    });

    it('returns 400 VALIDATION_ERROR on missing required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/policy-constraints',
        payload: {
          policyConstraintId: 'PC-SEC-003'
          // statement, authorityReference, createdBy missing
        }
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/policy-constraints/:revisionId', () => {
    it('returns 200 with policy constraint revision when found', async () => {
      const postRes = await app.inject({
        method: 'POST',
        url: '/api/policy-constraints',
        payload: {
          policyConstraintId: 'PC-DATA-001',
          statement: 'Personal data must be masked in logs.',
          authorityReference: 'GDPR Art 25',
          state: 'ACCEPTED',
          createdBy: 'dpo-01'
        }
      });
      const created = postRes.json();

      const getRes = await app.inject({
        method: 'GET',
        url: `/api/policy-constraints/${created.id}`
      });
      expect(getRes.statusCode).toBe(200);
      const body = getRes.json();
      expect(body.id).toBe(created.id);
      expect(body.statement).toBe('Personal data must be masked in logs.');
    });

    it('returns 404 POLICY_CONSTRAINT_NOT_FOUND when not found', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/policy-constraints/PC-NONEXISTENT@r1'
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('POLICY_CONSTRAINT_NOT_FOUND');
    });
  });
});
