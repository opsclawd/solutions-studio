import { describe, it, expect } from 'vitest';
import { FINDING_TYPES, FINDING_DISPOSITIONS, DISCOVERED_BY } from '@solutions-studio/domain';
import {
  FindingTypeSchema,
  FindingDispositionSchema,
  DiscoveredBySchema,
  FindingEvaluationDtoSchema
} from '../../src/evaluation/index.js';

describe('Evaluation Contract Schemas', () => {
  it('FindingTypeSchema round-trips against domain FINDING_TYPES', () => {
    for (const type of FINDING_TYPES) {
      expect(FindingTypeSchema.parse(type)).toBe(type);
    }
    expect(() => FindingTypeSchema.parse('non-existent-type')).toThrow();
  });

  it('FindingDispositionSchema round-trips against domain FINDING_DISPOSITIONS', () => {
    for (const disposition of FINDING_DISPOSITIONS) {
      expect(FindingDispositionSchema.parse(disposition)).toBe(disposition);
    }
    expect(() => FindingDispositionSchema.parse('UNKNOWN_DISPOSITION')).toThrow();
  });

  it('DiscoveredBySchema round-trips against domain DISCOVERED_BY', () => {
    for (const discoveredBy of DISCOVERED_BY) {
      expect(DiscoveredBySchema.parse(discoveredBy)).toBe(discoveredBy);
    }
    expect(() => DiscoveredBySchema.parse('alien')).toThrow();
  });

  it('FindingEvaluationDtoSchema validates valid evaluation DTO and rejects invalid', () => {
    const valid = {
      findingId: 'FINDING-01',
      type: 'missing-authorization',
      disposition: 'RESOLVED',
      discoveredBy: 'heuristic',
      rationale: 'Auditable explanation'
    };
    const parsed = FindingEvaluationDtoSchema.parse(valid);
    expect(parsed).toEqual(valid);

    expect(() =>
      FindingEvaluationDtoSchema.parse({
        findingId: '',
        type: 'missing-authorization',
        disposition: 'RESOLVED',
        discoveredBy: 'heuristic'
      })
    ).toThrow();
  });
});
