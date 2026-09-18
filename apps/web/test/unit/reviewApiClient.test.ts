import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { apiClient, ApiError } from '../../src/features/review/api/client';
import {
  recordRequirementDiscovery,
  recordFindingDiscovery
} from '../../src/features/review/api/mutations';

describe('Review API Client', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('parses successful JSON response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'REQ-1-R1', statement: 'Sample statement' })
    } as Response);

    const result = await apiClient<{ id: string; statement: string }>(
      '/api/requirements/REQ-1-R1/accept',
      {
        baseUrl: 'http://test-server'
      }
    );

    expect(result).toEqual({ id: 'REQ-1-R1', statement: 'Sample statement' });
    expect(global.fetch).toHaveBeenCalledWith(
      'http://test-server/api/requirements/REQ-1-R1/accept',
      expect.any(Object)
    );
  });

  it('throws ApiError on 409 STALE_REVISION_TARGET with details preserved', async () => {
    const errorPayload = {
      code: 'STALE_REVISION_TARGET',
      message: 'Target revision REQ-1-R1 is stale',
      details: {
        revisionId: 'REQ-1-R1',
        latestRevisionId: 'REQ-1-R2'
      }
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      text: async () => JSON.stringify(errorPayload)
    } as Response);

    await expect(
      apiClient('/api/requirements/REQ-1-R1/accept', { baseUrl: 'http://test-server' })
    ).rejects.toThrow(ApiError);

    try {
      await apiClient('/api/requirements/REQ-1-R1/accept', { baseUrl: 'http://test-server' });
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe('STALE_REVISION_TARGET');
      expect(apiErr.statusCode).toBe(409);
      expect(apiErr.message).toBe('Target revision REQ-1-R1 is stale');
      expect(apiErr.details).toEqual({
        revisionId: 'REQ-1-R1',
        latestRevisionId: 'REQ-1-R2'
      });
    }
  });

  it('throws ApiError on 400 RATIONALE_REQUIRED', async () => {
    const errorPayload = {
      code: 'RATIONALE_REQUIRED',
      message: 'Rationale must be non-empty'
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => JSON.stringify(errorPayload)
    } as Response);

    try {
      await apiClient('/api/requirements/REQ-1-R1/accept', { baseUrl: 'http://test-server' });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe('RATIONALE_REQUIRED');
      expect(apiErr.statusCode).toBe(400);
    }
  });

  it('handles non-JSON error bodies gracefully as INTERNAL_ERROR', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: async () => '<html><body>Bad Gateway</body></html>'
    } as Response);

    try {
      await apiClient('/api/requirements/review-state', { baseUrl: 'http://test-server' });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe('INTERNAL_ERROR');
      expect(apiErr.statusCode).toBe(502);
    }
  });

  it('recordRequirementDiscovery sends POST to /api/requirements/discoveries and returns parsed RequirementRevisionDto', async () => {
    const mockResponse = {
      id: 'REQ-100-R1',
      requirementId: 'REQ-100',
      revision: 1,
      statement: 'SME proposed requirement',
      category: 'business-rule',
      origin: 'REVIEWER_PROPOSAL',
      reviewState: 'PENDING',
      resolutionState: 'UNRESOLVED',
      evidence: [],
      rationale: 'Discovered during prototype review',
      actorId: 'sme-1'
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse
    } as Response);

    const result = await recordRequirementDiscovery({
      statement: 'SME proposed requirement',
      category: 'business-rule',
      rationale: 'Discovered during prototype review',
      actorId: 'sme-1'
    });

    expect(result).toEqual(mockResponse);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/requirements/discoveries',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          statement: 'SME proposed requirement',
          category: 'business-rule',
          rationale: 'Discovered during prototype review',
          actorId: 'sme-1'
        })
      })
    );
  });

  it('recordFindingDiscovery sends POST to /api/findings/discoveries and returns parsed CandidateFindingDto', async () => {
    const mockResponse = {
      id: 'FINDING-100',
      type: 'missing-authorization',
      affectedRequirementRevisions: [],
      evidence: [],
      discoveredBy: 'artifact-validation',
      disposition: 'OPEN',
      rationale: 'Discovered during diagram review'
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse
    } as Response);

    const result = await recordFindingDiscovery({
      type: 'missing-authorization',
      discoveredBy: 'artifact-validation',
      rationale: 'Discovered during diagram review'
    });

    expect(result).toEqual(mockResponse);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/findings/discoveries',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          type: 'missing-authorization',
          discoveredBy: 'artifact-validation',
          rationale: 'Discovered during diagram review'
        })
      })
    );
  });
});
