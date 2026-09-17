import { describe, it, expect } from 'vitest';
import {
  createRequirementRevisionId,
  createRequirementId,
  createRequirementRevision,
  createFindingId,
  createCandidateFinding,
  type RequirementRevision
} from '@solutions-studio/domain';
import {
  resolveRevisionLineage,
  selectBlockingFindings
} from '../../src/application/use-cases/resolveRevisionLineage.js';
import {
  MissingRevisionAncestorError,
  RevisionLineageCycleError,
  UnknownRequirementRevisionError
} from '../../src/application/use-cases/ReconciliationErrors.js';

describe('resolveRevisionLineage and selectBlockingFindings', () => {
  const reqId1 = createRequirementId('REQ-001');
  const reqId2 = createRequirementId('REQ-002');

  const r1_1 = createRequirementRevision({
    id: createRequirementRevisionId('REQ-001-R1'),
    requirementId: reqId1,
    revision: 1,
    statement: 'Req 1 Rev 1',
    category: 'business-rule',
    origin: 'EXPLICIT',
    reviewState: 'ACCEPTED',
    resolutionState: 'CLEAR'
  });

  const r1_2 = createRequirementRevision({
    id: createRequirementRevisionId('REQ-001-R2'),
    requirementId: reqId1,
    revision: 2,
    statement: 'Req 1 Rev 2',
    category: 'business-rule',
    origin: 'EXPLICIT',
    reviewState: 'ACCEPTED',
    resolutionState: 'CLEAR',
    supersedes: r1_1.id
  });

  const r1_3 = createRequirementRevision({
    id: createRequirementRevisionId('REQ-001-R3'),
    requirementId: reqId1,
    revision: 3,
    statement: 'Req 1 Rev 3',
    category: 'business-rule',
    origin: 'EXPLICIT',
    reviewState: 'ACCEPTED',
    resolutionState: 'CLEAR',
    supersedes: r1_2.id
  });

  const r2_1 = createRequirementRevision({
    id: createRequirementRevisionId('REQ-002-R1'),
    requirementId: reqId2,
    revision: 1,
    statement: 'Req 2 Rev 1',
    category: 'business-rule',
    origin: 'EXPLICIT',
    reviewState: 'ACCEPTED',
    resolutionState: 'CLEAR'
  });

  const map = new Map<string, RequirementRevision>([
    [r1_1.id, r1_1],
    [r1_2.id, r1_2],
    [r1_3.id, r1_3],
    [r2_1.id, r2_1]
  ]);

  const lookup = async (id: string) => map.get(id);

  describe('resolveRevisionLineage', () => {
    it('resolves complete linear lineage closure and ancestry map', async () => {
      const lineage = await resolveRevisionLineage([r1_3.id, r2_1.id], lookup);

      expect(lineage.closure.has(r1_3.id)).toBe(true);
      expect(lineage.closure.has(r1_2.id)).toBe(true);
      expect(lineage.closure.has(r1_1.id)).toBe(true);
      expect(lineage.closure.has(r2_1.id)).toBe(true);
      expect(lineage.closure.size).toBe(4);

      expect(lineage.proposedToAncestors.get(r1_3.id)).toEqual([r1_3.id, r1_2.id, r1_1.id]);
      expect(lineage.proposedToAncestors.get(r2_1.id)).toEqual([r2_1.id]);

      expect(lineage.ancestorToProposed.get(r1_1.id)).toEqual([r1_3.id]);
      expect(lineage.ancestorToProposed.get(r1_2.id)).toEqual([r1_3.id]);
      expect(lineage.ancestorToProposed.get(r1_3.id)).toEqual([r1_3.id]);
      expect(lineage.ancestorToProposed.get(r2_1.id)).toEqual([r2_1.id]);
    });

    it('throws UnknownRequirementRevisionError if proposed revision is not found', async () => {
      await expect(
        resolveRevisionLineage([createRequirementRevisionId('UNKNOWN-R1')], lookup)
      ).rejects.toThrow(UnknownRequirementRevisionError);
    });

    it('throws MissingRevisionAncestorError if an ancestor in supersedes chain is missing', async () => {
      const brokenRev = createRequirementRevision({
        id: createRequirementRevisionId('REQ-BROKEN-R2'),
        requirementId: createRequirementId('REQ-BROKEN'),
        revision: 2,
        statement: 'Broken',
        category: 'business-rule',
        origin: 'EXPLICIT',
        supersedes: createRequirementRevisionId('MISSING-R1')
      });
      const brokenLookup = async (id: string) => {
        if (id === brokenRev.id) return brokenRev;
        return undefined;
      };

      await expect(resolveRevisionLineage([brokenRev.id], brokenLookup)).rejects.toThrow(
        MissingRevisionAncestorError
      );
    });

    it('throws RevisionLineageCycleError if cycle is detected in lineage', async () => {
      const cycleR1 = createRequirementRevision({
        id: createRequirementRevisionId('CYCLE-R1'),
        requirementId: createRequirementId('CYCLE'),
        revision: 1,
        statement: 'Cycle 1',
        category: 'business-rule',
        origin: 'EXPLICIT',
        supersedes: createRequirementRevisionId('CYCLE-R2')
      });
      const cycleR2 = createRequirementRevision({
        id: createRequirementRevisionId('CYCLE-R2'),
        requirementId: createRequirementId('CYCLE'),
        revision: 2,
        statement: 'Cycle 2',
        category: 'business-rule',
        origin: 'EXPLICIT',
        supersedes: createRequirementRevisionId('CYCLE-R1')
      });

      const cycleMap = new Map<string, RequirementRevision>([
        [cycleR1.id, cycleR1],
        [cycleR2.id, cycleR2]
      ]);

      await expect(
        resolveRevisionLineage([cycleR1.id], async (id) => cycleMap.get(id))
      ).rejects.toThrow(RevisionLineageCycleError);
    });
  });

  describe('selectBlockingFindings', () => {
    it('blocks when OPEN finding affects ancestor R1 while baseline proposes R3', async () => {
      const finding = createCandidateFinding({
        id: createFindingId('FINDING-1'),
        type: 'contradiction',
        affectedRequirementRevisions: [r1_1.id],
        discoveredBy: 'model',
        disposition: 'OPEN'
      });

      const blocking = await selectBlockingFindings([finding], [r1_3.id], lookup);

      expect(blocking).toHaveLength(1);
      expect(blocking[0].id).toBe('FINDING-1');
      expect(blocking[0].matchedRevisionId).toBe(r1_1.id);
      expect(blocking[0].proposedRevisionId).toBe(r1_3.id);
      expect(blocking[0].disposition).toBe('OPEN');
    });

    it('does NOT block when open finding affects unrelated requirement', async () => {
      const findingUnrelated = createCandidateFinding({
        id: createFindingId('FINDING-UNRELATED'),
        type: 'contradiction',
        affectedRequirementRevisions: [r2_1.id],
        discoveredBy: 'model',
        disposition: 'OPEN'
      });

      // Proposed is only REQ-001-R3, so finding affecting REQ-002 does not block
      const blocking = await selectBlockingFindings([findingUnrelated], [r1_3.id], lookup);
      expect(blocking).toHaveLength(0);
    });

    it('does NOT block when finding is non-OPEN (RESOLVED, DISMISSED_FALSE_POSITIVE, ACCEPTED_RISK)', async () => {
      const findings = [
        createCandidateFinding({
          id: createFindingId('F-RES'),
          type: 'contradiction',
          affectedRequirementRevisions: [r1_1.id],
          discoveredBy: 'model',
          disposition: 'RESOLVED',
          rationale: 'Resolved in review'
        }),
        createCandidateFinding({
          id: createFindingId('F-FP'),
          type: 'missing-authorization',
          affectedRequirementRevisions: [r1_2.id],
          discoveredBy: 'model',
          disposition: 'DISMISSED_FALSE_POSITIVE',
          rationale: 'Dismissed as false positive'
        }),
        createCandidateFinding({
          id: createFindingId('F-RISK'),
          type: 'temporal-ambiguity',
          affectedRequirementRevisions: [r1_3.id],
          discoveredBy: 'model',
          disposition: 'ACCEPTED_RISK',
          rationale: 'Accepted business risk'
        })
      ];

      const blocking = await selectBlockingFindings(findings, [r1_3.id], lookup);
      expect(blocking).toHaveLength(0);
    });

    it('preserves stable input order and reports multiple blocking matches with diagnostic details', async () => {
      const f1 = createCandidateFinding({
        id: createFindingId('FIND-A'),
        type: 'contradiction',
        affectedRequirementRevisions: [r1_1.id],
        discoveredBy: 'model',
        disposition: 'OPEN'
      });
      const f2 = createCandidateFinding({
        id: createFindingId('FIND-B'),
        type: 'missing-authorization',
        affectedRequirementRevisions: [r2_1.id],
        discoveredBy: 'model',
        disposition: 'OPEN'
      });

      const blocking = await selectBlockingFindings([f1, f2], [r1_3.id, r2_1.id], lookup);

      expect(blocking).toHaveLength(2);
      expect(blocking[0].id).toBe('FIND-A');
      expect(blocking[0].matchedRevisionId).toBe(r1_1.id);
      expect(blocking[0].proposedRevisionId).toBe(r1_3.id);

      expect(blocking[1].id).toBe('FIND-B');
      expect(blocking[1].matchedRevisionId).toBe(r2_1.id);
      expect(blocking[1].proposedRevisionId).toBe(r2_1.id);
    });
  });
});
