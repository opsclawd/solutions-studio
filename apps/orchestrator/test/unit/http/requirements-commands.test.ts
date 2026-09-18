import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  createRequirementId,
  createRequirementRevisionId,
  createRequirementRevision
} from '@solutions-studio/domain';
import { RequirementRevisionDtoSchema } from '@solutions-studio/contracts';
import { FilesystemRequirementsRepository } from '../../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeGenerationGateway } from '../../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../../fakes/FakeMermaidLinterGateway.js';
import { composeOrchestratorHttpServer } from '../../../src/http/composition.js';

describe('HTTP Boundary: Requirements Commands API', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let app: FastifyInstance;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'http-req-test-'));
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

  async function seedPendingRequirement(reqId = 'REQ-001', revId = 'REQ-001-R1') {
    const rev = createRequirementRevision({
      id: createRequirementRevisionId(revId),
      requirementId: createRequirementId(reqId),
      revision: 1,
      statement: 'Initial statement for requirement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'PENDING',
      resolutionState: 'UNRESOLVED',
      evidence: []
    });
    await repo.saveRequirementRevision(rev);
    return rev;
  }

  describe('POST /api/requirements/:revisionId/accept', () => {
    it('accepts requirement revision and returns 200 with ACCEPTED status', async () => {
      await seedPendingRequirement();

      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements/REQ-001-R1/accept',
        payload: {
          rationale: 'Validated against requirements spec',
          actorId: 'reviewer-alice'
        }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const validated = RequirementRevisionDtoSchema.parse(body);
      expect(validated.reviewState).toBe('ACCEPTED');
      expect(validated.revision).toBe(2);
      expect(validated.rationale).toBe('Validated against requirements spec');
    });

    it('rejects accept on already ACCEPTED revision with 409 INVALID_TRANSITION', async () => {
      await seedPendingRequirement();

      // First accept
      const first = await app.inject({
        method: 'POST',
        url: '/api/requirements/REQ-001-R1/accept',
        payload: { rationale: 'Initial acceptance' }
      });
      expect(first.statusCode).toBe(200);

      // Attempting to accept the now-accepted R2
      const second = await app.inject({
        method: 'POST',
        url: '/api/requirements/REQ-001-R2/accept',
        payload: { rationale: 'Second acceptance attempt' }
      });
      expect(second.statusCode).toBe(409);
      expect(second.json().code).toBe('INVALID_TRANSITION');
    });

    it('returns 400 VALIDATION_ERROR when rationale is empty or missing', async () => {
      await seedPendingRequirement();

      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements/REQ-001-R1/accept',
        payload: { rationale: '' }
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 REQUIREMENT_REVISION_NOT_FOUND when revision does not exist', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements/NONEXISTENT-R1/accept',
        payload: { rationale: 'Some rationale' }
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('REQUIREMENT_REVISION_NOT_FOUND');
    });
  });

  describe('POST /api/requirements/:revisionId/reject', () => {
    it('rejects requirement revision and returns 200 with REJECTED status', async () => {
      await seedPendingRequirement();

      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements/REQ-001-R1/reject',
        payload: {
          rationale: 'Out of scope for current sprint'
        }
      });

      expect(res.statusCode).toBe(200);
      const validated = RequirementRevisionDtoSchema.parse(res.json());
      expect(validated.reviewState).toBe('REJECTED');
    });
  });

  describe('POST /api/requirements/:revisionId/revise', () => {
    it('revises requirement and updates statement', async () => {
      await seedPendingRequirement();

      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements/REQ-001-R1/revise',
        payload: {
          statement: 'Clarified statement wording',
          rationale: 'Improved clarity based on reviewer feedback'
        }
      });

      expect(res.statusCode).toBe(200);
      const validated = RequirementRevisionDtoSchema.parse(res.json());
      expect(validated.statement).toBe('Clarified statement wording');
      expect(validated.revision).toBe(2);
    });

    it('returns 400 VALIDATION_ERROR on invalid category', async () => {
      await seedPendingRequirement();

      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements/REQ-001-R1/revise',
        payload: {
          category: 'invalid-category',
          rationale: 'Testing invalid enum'
        }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/requirements/:revisionId/resolve', () => {
    it('resolves requirement and sets resolutionState to CLEAR', async () => {
      await seedPendingRequirement();

      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements/REQ-001-R1/resolve',
        payload: {
          rationale: 'Ambiguity addressed'
        }
      });

      expect(res.statusCode).toBe(200);
      const validated = RequirementRevisionDtoSchema.parse(res.json());
      expect(validated.resolutionState).toBe('CLEAR');
    });

    it('returns 409 INVALID_TRANSITION when already CLEAR', async () => {
      const rev = createRequirementRevision({
        id: createRequirementRevisionId('REQ-002-R1'),
        requirementId: createRequirementId('REQ-002'),
        revision: 1,
        statement: 'Clear requirement',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'PENDING',
        resolutionState: 'CLEAR',
        evidence: []
      });
      await repo.saveRequirementRevision(rev);

      const res = await app.inject({
        method: 'POST',
        url: '/api/requirements/REQ-002-R1/resolve',
        payload: {
          rationale: 'Already clear'
        }
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('INVALID_TRANSITION');
    });
  });
});
