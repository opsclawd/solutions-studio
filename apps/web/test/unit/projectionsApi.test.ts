import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateProjection,
  listProjections,
  getProjection
} from '../../src/features/review/api/projectionsApi';
import { ApiError } from '../../src/features/review/api/client';
import type { ProjectionRecordDto } from '@solutions-studio/contracts';
import { createInstant } from '@solutions-studio/domain';

describe('projectionsApi', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const sampleProjection: ProjectionRecordDto = {
    id: 'PROJ-001',
    baselineId: 'BASE-001',
    requirementRevisionIds: ['REQ-002-R1'],
    artifactType: 'process-diagram',
    content: 'graph TD\n  A --> B',
    metadata: {
      baselineId: 'BASE-001',
      requirementRevisionIds: ['REQ-002-R1'],
      artifactType: 'process-diagram',
      declaredProvenance: {
        baselineId: 'BASE-001',
        requirementRevisionIds: ['REQ-002-R1']
      },
      configuredExecution: {
        provider: 'fake',
        artifactType: 'process-diagram'
      },
      measuredVerification: {
        repairsNeeded: 0,
        attemptCount: 1,
        contentHash: 'mockhash123',
        verifiedAt: createInstant('2026-09-18T12:00:00.000Z')
      }
    },
    createdAt: createInstant('2026-09-18T12:00:00.000Z')
  };

  it('generateProjection posts and returns parsed ProjectionRecordDto', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sampleProjection
    } as Response);

    const result = await generateProjection('BASE-001', {
      artifactType: 'process-diagram',
      prompt: 'Optional prompt'
    });

    expect(result.id).toBe('PROJ-001');
    expect(result.baselineId).toBe('BASE-001');
    expect(result.metadata.measuredVerification.repairsNeeded).toBe(0);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/baselines/BASE-001/projections'),
      expect.objectContaining({
        method: 'POST'
      })
    );
  });

  it('generateProjection throws ApiError on 502 ARTIFACT_GENERATION_FAILED', async () => {
    const errorPayload = {
      code: 'ARTIFACT_GENERATION_FAILED',
      message: 'Artifact generation failed after 3 attempts',
      details: {
        attempts: 3,
        errors: ['Parse error on line 4']
      }
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: async () => JSON.stringify(errorPayload)
    } as Response);

    await expect(
      generateProjection('BASE-001', { artifactType: 'process-diagram' })
    ).rejects.toThrow(ApiError);

    try {
      await generateProjection('BASE-001', { artifactType: 'process-diagram' });
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe('ARTIFACT_GENERATION_FAILED');
      expect(apiErr.statusCode).toBe(502);
      expect((apiErr.details as { attempts: number })?.attempts).toBe(3);
    }
  });

  it('listProjections gets and returns list of ProjectionRecordDto', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [sampleProjection]
    } as Response);

    const list = await listProjections('BASE-001');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('PROJ-001');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/baselines/BASE-001/projections'),
      expect.objectContaining({
        method: 'GET'
      })
    );
  });

  it('getProjection gets single projection record by ID', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sampleProjection
    } as Response);

    const result = await getProjection('BASE-001', 'PROJ-001');
    expect(result.id).toBe('PROJ-001');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/baselines/BASE-001/projections/PROJ-001'),
      expect.objectContaining({
        method: 'GET'
      })
    );
  });

  it('getProjection throws ApiError on 404 PROJECTION_NOT_FOUND', async () => {
    const errorPayload = {
      code: 'PROJECTION_NOT_FOUND',
      message: 'Projection not found'
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => JSON.stringify(errorPayload)
    } as Response);

    await expect(getProjection('BASE-001', 'UNKNOWN-PROJ')).rejects.toThrow(ApiError);
  });
});
