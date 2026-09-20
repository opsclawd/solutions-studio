import { describe, it, expect } from 'vitest';
import {
  createBacklogExportMapping,
  createBacklogExportMappingId,
  InvalidBacklogMappingError,
  StoryNotReadyForExportError
} from '../../src/backlog/index.js';

describe('BacklogExportMapping Domain Entity', () => {
  const validParams = {
    id: 'bmap-001',
    storyId: 'STORY-001',
    baselineId: 'base-001',
    provider: 'github-issues',
    externalContainer: 'acme/repo',
    externalWorkItemId: '42',
    externalUrl: 'https://github.com/acme/repo/issues/42',
    exportContentHash: 'a'.repeat(64),
    exportedAt: '2026-09-20T12:00:00.000Z',
    exportedBy: 'actor-001',
    metadata: { testKey: 'testValue' }
  };

  it('creates a BacklogExportMapping with valid parameters', () => {
    const mapping = createBacklogExportMapping(validParams);

    expect(mapping.id).toBe('bmap-001');
    expect(mapping.storyId).toBe('STORY-001');
    expect(mapping.baselineId).toBe('base-001');
    expect(mapping.provider).toBe('github-issues');
    expect(mapping.externalContainer).toBe('acme/repo');
    expect(mapping.externalWorkItemId).toBe('42');
    expect(mapping.externalUrl).toBe('https://github.com/acme/repo/issues/42');
    expect(mapping.exportContentHash).toBe('a'.repeat(64));
    expect(mapping.exportedAt).toBe('2026-09-20T12:00:00.000Z');
    expect(mapping.exportedBy).toBe('actor-001');
    expect(mapping.metadata).toEqual({ testKey: 'testValue' });
  });

  it('freezes the returned mapping', () => {
    const mapping = createBacklogExportMapping(validParams);
    expect(Object.isFrozen(mapping)).toBe(true);
    expect(() => {
      (mapping as any).provider = 'jira';
    }).toThrow();
  });

  it('rejects empty id or fields', () => {
    expect(() => createBacklogExportMapping({ ...validParams, id: '' })).toThrow(
      InvalidBacklogMappingError
    );
    expect(() => createBacklogExportMapping({ ...validParams, storyId: ' ' })).toThrow(
      InvalidBacklogMappingError
    );
    expect(() => createBacklogExportMapping({ ...validParams, baselineId: '' })).toThrow(
      InvalidBacklogMappingError
    );
    expect(() => createBacklogExportMapping({ ...validParams, provider: '' })).toThrow(
      InvalidBacklogMappingError
    );
    expect(() => createBacklogExportMapping({ ...validParams, externalContainer: '' })).toThrow(
      InvalidBacklogMappingError
    );
    expect(() => createBacklogExportMapping({ ...validParams, externalWorkItemId: '' })).toThrow(
      InvalidBacklogMappingError
    );
    expect(() => createBacklogExportMapping({ ...validParams, exportedBy: '' })).toThrow(
      InvalidBacklogMappingError
    );
  });

  it('rejects invalid SHA-256 content hash', () => {
    expect(() =>
      createBacklogExportMapping({ ...validParams, exportContentHash: 'short-hash' })
    ).toThrow(InvalidBacklogMappingError);
    expect(() =>
      createBacklogExportMapping({ ...validParams, exportContentHash: 'z'.repeat(64) })
    ).toThrow(InvalidBacklogMappingError);
  });

  it('rejects invalid exportedAt instant', () => {
    expect(() =>
      createBacklogExportMapping({ ...validParams, exportedAt: 'invalid-date' })
    ).toThrow();
  });

  it('constructs StoryNotReadyForExportError with reasons', () => {
    const error = new StoryNotReadyForExportError('STORY-1', ['no-blocking-open-findings']);
    expect(error.storyId).toBe('STORY-1');
    expect(error.rejectionReasons).toEqual(['no-blocking-open-findings']);
    expect(error.message).toContain('STORY-1');
    expect(error.message).toContain('no-blocking-open-findings');
  });

  it('creates branded BacklogExportMappingId', () => {
    const id = createBacklogExportMappingId('bmap-123');
    expect(id).toBe('bmap-123');
    expect(() => createBacklogExportMappingId('  ')).toThrow();
  });
});
