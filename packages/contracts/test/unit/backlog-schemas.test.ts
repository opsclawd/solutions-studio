import { describe, it, expect } from 'vitest';
import {
  BacklogExportMappingDtoSchema,
  ExportStoryItemResultDtoSchema,
  ExportBacklogRequestDtoSchema,
  ExportBacklogResponseDtoSchema
} from '../../src/backlog/index.js';

describe('Backlog Contracts Schemas', () => {
  const validMappingDto = {
    id: 'bmap-1',
    storyId: 'STORY-1',
    baselineId: 'base-1',
    provider: 'github-issues',
    externalContainer: 'owner/repo',
    externalWorkItemId: '101',
    externalUrl: 'https://github.com/owner/repo/issues/101',
    exportContentHash: 'b'.repeat(64),
    exportedAt: '2026-09-20T12:00:00.000Z',
    exportedBy: 'actor-1'
  };

  it('validates BacklogExportMappingDtoSchema', () => {
    const parsed = BacklogExportMappingDtoSchema.parse(validMappingDto);
    expect(parsed.id).toBe('bmap-1');
    expect(parsed.externalWorkItemId).toBe('101');

    expect(() =>
      BacklogExportMappingDtoSchema.parse({
        ...validMappingDto,
        exportContentHash: 'invalid-hash'
      })
    ).toThrow();
  });

  describe('ExportStoryItemResultDtoSchema discriminated union', () => {
    it('validates success variants (created, updated, unchanged)', () => {
      const created = ExportStoryItemResultDtoSchema.parse({
        storyId: 'STORY-1',
        status: 'created',
        externalWorkItemId: '42',
        externalUrl: 'https://github.com/owner/repo/issues/42',
        exportContentHash: 'c'.repeat(64),
        exportedAt: '2026-09-20T12:00:00.000Z'
      });
      expect(created.status).toBe('created');

      const updated = ExportStoryItemResultDtoSchema.parse({
        storyId: 'STORY-1',
        status: 'updated',
        externalWorkItemId: '42',
        exportContentHash: 'c'.repeat(64),
        exportedAt: '2026-09-20T12:00:00.000Z'
      });
      expect(updated.status).toBe('updated');

      const unchanged = ExportStoryItemResultDtoSchema.parse({
        storyId: 'STORY-1',
        status: 'unchanged',
        externalWorkItemId: '42',
        exportContentHash: 'c'.repeat(64),
        exportedAt: '2026-09-20T12:00:00.000Z'
      });
      expect(unchanged.status).toBe('unchanged');
    });

    it('rejects success variant without externalWorkItemId', () => {
      expect(() =>
        ExportStoryItemResultDtoSchema.parse({
          storyId: 'STORY-1',
          status: 'created',
          exportContentHash: 'c'.repeat(64),
          exportedAt: '2026-09-20T12:00:00.000Z'
        })
      ).toThrow();
    });

    it('validates rejected variant', () => {
      const rejected = ExportStoryItemResultDtoSchema.parse({
        storyId: 'STORY-2',
        status: 'rejected',
        rejectionReasons: ['no-blocking-open-findings'],
        readinessFailures: [{ rule: 'no-blocking-open-findings', message: 'Finding open' }]
      });
      expect(rejected.status).toBe('rejected');
      if (rejected.status === 'rejected') {
        expect(rejected.rejectionReasons).toEqual(['no-blocking-open-findings']);
      }
    });

    it('rejects rejected variant without rejectionReasons', () => {
      expect(() =>
        ExportStoryItemResultDtoSchema.parse({
          storyId: 'STORY-2',
          status: 'rejected',
          rejectionReasons: []
        })
      ).toThrow();
    });

    it('validates failed variant', () => {
      const failed = ExportStoryItemResultDtoSchema.parse({
        storyId: 'STORY-3',
        status: 'failed',
        errorMessage: 'Rate limit exceeded',
        errorType: 'ProviderRateLimitError',
        retryable: true
      });
      expect(failed.status).toBe('failed');
      if (failed.status === 'failed') {
        expect(failed.retryable).toBe(true);
      }
    });

    it('rejects failed variant without errorMessage or retryable flag', () => {
      expect(() =>
        ExportStoryItemResultDtoSchema.parse({
          storyId: 'STORY-3',
          status: 'failed',
          errorMessage: 'some error'
        })
      ).toThrow();
    });
  });

  it('validates ExportBacklogRequestDtoSchema and applies defaults', () => {
    const parsed = ExportBacklogRequestDtoSchema.parse({
      targetContainer: 'owner/repo'
    });
    expect(parsed.provider).toBe('github-issues');
    expect(parsed.forceUpdate).toBe(false);
    expect(parsed.targetContainer).toBe('owner/repo');
  });

  it('validates ExportBacklogResponseDtoSchema', () => {
    const response = ExportBacklogResponseDtoSchema.parse({
      baselineId: 'base-1',
      provider: 'github-issues',
      externalContainer: 'owner/repo',
      items: [
        {
          storyId: 'STORY-1',
          status: 'created',
          externalWorkItemId: '42',
          exportContentHash: 'd'.repeat(64),
          exportedAt: '2026-09-20T12:00:00.000Z'
        },
        {
          storyId: 'STORY-2',
          status: 'rejected',
          rejectionReasons: ['rule-1']
        }
      ],
      summary: {
        total: 2,
        created: 1,
        updated: 0,
        unchanged: 0,
        rejected: 1,
        failed: 0
      },
      exportedAt: '2026-09-20T12:00:00.000Z'
    });

    expect(response.baselineId).toBe('base-1');
    expect(response.items).toHaveLength(2);
    expect(response.summary.created).toBe(1);
    expect(response.summary.rejected).toBe(1);
  });
});
