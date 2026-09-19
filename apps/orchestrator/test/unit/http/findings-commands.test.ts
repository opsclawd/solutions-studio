import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createFindingId, createCandidateFinding } from '@solutions-studio/domain';
import { CandidateFindingDtoSchema } from '@solutions-studio/contracts';
import { FilesystemRequirementsRepository } from '../../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeGenerationGateway } from '../../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../../fakes/FakeMermaidLinterGateway.js';
import { composeOrchestratorHttpServer } from '../../../src/http/composition.js';

describe('HTTP Boundary: Findings Commands API', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let app: FastifyInstance;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'http-findings-test-'));
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

  async function seedOpenFinding(findingId = 'FIND-001') {
    const finding = createCandidateFinding({
      id: createFindingId(findingId),
      type: 'missing-authorization',
      affectedRequirementRevisions: [],
      evidence: [],
      discoveredBy: 'model',
      disposition: 'OPEN'
    });
    await repo.saveCandidateFinding(finding);
    return finding;
  }

  describe('POST /api/findings/:findingId/disposition', () => {
    it('dispositions finding to RESOLVED and returns 200 with updated DTO', async () => {
      await seedOpenFinding('FIND-001');

      const res = await app.inject({
        method: 'POST',
        url: '/api/findings/FIND-001/disposition',
        payload: {
          disposition: 'RESOLVED',
          rationale: 'Resolved by adding required access check in specification',
          actorId: 'auditor-1'
        }
      });

      expect(res.statusCode).toBe(200);
      const validated = CandidateFindingDtoSchema.parse(res.json());
      expect(validated.disposition).toBe('RESOLVED');
      expect(validated.rationale).toBe('Resolved by adding required access check in specification');
    });

    it('returns 400 on empty rationale', async () => {
      await seedOpenFinding('FIND-001');

      const res = await app.inject({
        method: 'POST',
        url: '/api/findings/FIND-001/disposition',
        payload: {
          disposition: 'RESOLVED',
          rationale: '   '
        }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 on invalid disposition enum', async () => {
      await seedOpenFinding('FIND-001');

      const res = await app.inject({
        method: 'POST',
        url: '/api/findings/FIND-001/disposition',
        payload: {
          disposition: 'INVALID_STATUS',
          rationale: 'Testing'
        }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 on non-existent finding', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/findings/FIND-NOT-FOUND/disposition',
        payload: {
          disposition: 'RESOLVED',
          rationale: 'Valid rationale'
        }
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('FINDING_NOT_FOUND');
    });

    it('returns 409 INVALID_TRANSITION when setting to same disposition', async () => {
      await seedOpenFinding('FIND-001');

      const res = await app.inject({
        method: 'POST',
        url: '/api/findings/FIND-001/disposition',
        payload: {
          disposition: 'OPEN',
          rationale: 'Already OPEN'
        }
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('INVALID_TRANSITION');
    });
  });

  describe('POST /api/findings/:findingId/reopen', () => {
    it('reopens a resolved finding to OPEN', async () => {
      await seedOpenFinding('FIND-001');

      // First resolve
      await app.inject({
        method: 'POST',
        url: '/api/findings/FIND-001/disposition',
        payload: {
          disposition: 'RESOLVED',
          rationale: 'Initial resolution'
        }
      });

      // Now reopen
      const res = await app.inject({
        method: 'POST',
        url: '/api/findings/FIND-001/reopen',
        payload: {
          rationale: 'New evidence indicates risk still present'
        }
      });

      expect(res.statusCode).toBe(200);
      const validated = CandidateFindingDtoSchema.parse(res.json());
      expect(validated.disposition).toBe('OPEN');
    });

    it('returns 409 INVALID_TRANSITION when reopening an already OPEN finding', async () => {
      await seedOpenFinding('FIND-001');

      const res = await app.inject({
        method: 'POST',
        url: '/api/findings/FIND-001/reopen',
        payload: {
          rationale: 'Attempting to reopen already open finding'
        }
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('INVALID_TRANSITION');
    });
  });
});
