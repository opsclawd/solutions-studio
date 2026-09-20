import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  createSourceRevisionId,
  createRequirementId,
  createRequirementRevisionId,
  createFindingId,
  createRequirementsBaselineId,
  createReviewerId,
  createEvidenceLocator,
  createStoryId,
  createRequirementRevision,
  createCandidateFinding,
  now
} from '@solutions-studio/domain';
import {
  BlockedByOpenFindingsError,
  OptimisticConcurrencyConflictError,
  InvalidBaselineMembershipError,
  StaleRevisionTargetError
} from '../../../src/application/use-cases/ReconciliationErrors.js';
import { PGliteDatabaseClient } from '../../../src/infrastructure/persistence/postgres/PGliteDatabaseClient.js';
import { SchemaMigrationRunner } from '../../../src/infrastructure/persistence/postgres/SchemaMigrationRunner.js';
import { PostgresRequirementsRepository } from '../../../src/infrastructure/persistence/postgres/PostgresRequirementsRepository.js';
import { InMemoryObjectStore } from '../../../src/infrastructure/persistence/object-store/InMemoryObjectStore.js';
import type {
  ISqlDatabaseClient,
  QueryResultRow
} from '../../../src/application/ports/persistence/ISqlDatabaseClient.js';

describe('Adversarial Concurrency, Session Leasing, and OCC Enforcement', () => {
  let pglite: PGlite;
  let dbClient: PGliteDatabaseClient;
  let repo: PostgresRequirementsRepository;
  let objectStore: InMemoryObjectStore;

  beforeEach(async () => {
    pglite = new PGlite();
    dbClient = new PGliteDatabaseClient({ pgliteInstance: pglite });
    const runner = new SchemaMigrationRunner({ db: dbClient });
    await runner.migrate();

    objectStore = new InMemoryObjectStore();
    repo = new PostgresRequirementsRepository({
      db: dbClient,
      objectStore
    });
  }, 30000);

  afterEach(async () => {
    await dbClient.close().catch(() => {});
    await pglite.close().catch(() => {});
  });

  describe('Session-Scoped Advisory Locks with Leased Clients (F-22cda109)', () => {
    it('leases a session client via withSession and executes queries within that session', async () => {
      let leasedSessionsCount = 0;
      const wrappedDb: ISqlDatabaseClient = {
        query: <T = QueryResultRow>(sql: string, params?: readonly unknown[]) =>
          dbClient.query<T>(sql, params),
        exec: (sql: string) => dbClient.exec(sql),
        transaction: <T>(action: (client: ISqlDatabaseClient) => Promise<T>) =>
          dbClient.transaction(action),
        close: () => dbClient.close(),
        withSession: async <T>(action: (client: ISqlDatabaseClient) => Promise<T>): Promise<T> => {
          leasedSessionsCount++;
          return dbClient.withSession(action);
        }
      };

      const sessionRepo = new PostgresRequirementsRepository({
        db: wrappedDb,
        objectStore
      });

      const baselineId = createRequirementsBaselineId('BASE-LOCK-001');
      let insideLockSessionRan = false;

      await sessionRepo.withBaselineLock(baselineId, async () => {
        insideLockSessionRan = true;
        // Verify activeDb inside withBaselineLock executes successfully
        const check = await sessionRepo.activeDb.query('SELECT 1 as num;');
        expect(check.rows[0]).toEqual({ num: 1 });
      });

      expect(insideLockSessionRan).toBe(true);
      expect(leasedSessionsCount).toBe(1);
    });
  });

  describe('Adversarial Baseline Freeze & Open Findings Blocking (AC-2, F-41df0a7b, F-e5555daf)', () => {
    it('throws InvalidBaselineMembershipError when baseline manifest does not match expected revisions exactly', async () => {
      const baselineId = createRequirementsBaselineId('BASE-ADV-001');
      const reqId = createRequirementId('REQ-ADV-001');
      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-ADV-001-R1'),
        requirementId: reqId,
        revision: 1,
        statement: 'Statement 1',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR',
        evidence: [
          {
            sourceRevisionId: createSourceRevisionId('SRC-1'),
            locator: createEvidenceLocator('sec#1')
          }
        ],
        rationale: 'Initial'
      });
      await repo.saveRequirementRevision(rev1);

      const baseline = {
        id: baselineId,
        requirementRevisions: [rev1.id],
        policyConstraintRevisions: [],
        createdAt: now(),
        createdBy: createReviewerId('REV-1')
      };

      // Mismatch: expected revision differs from baseline manifest
      await expect(
        repo.saveRequirementsBaselineConditional(baseline, [
          createRequirementRevisionId('REQ-ADV-001-R2')
        ])
      ).rejects.toThrow(InvalidBaselineMembershipError);
    });

    it('throws StaleRevisionTargetError when expected revision is superseded concurrently during baseline freeze', async () => {
      const baselineId = createRequirementsBaselineId('BASE-ADV-002');
      const reqId = createRequirementId('REQ-ADV-002');
      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-ADV-002-R1'),
        requirementId: reqId,
        revision: 1,
        statement: 'Statement 1',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR',
        evidence: [
          {
            sourceRevisionId: createSourceRevisionId('SRC-1'),
            locator: createEvidenceLocator('sec#1')
          }
        ],
        rationale: 'Initial'
      });
      await repo.saveRequirementRevision(rev1);

      // Concurrent update produces rev2
      const rev2 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-ADV-002-R2'),
        requirementId: reqId,
        revision: 2,
        supersedes: rev1.id,
        statement: 'Statement 2',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR',
        evidence: [
          {
            sourceRevisionId: createSourceRevisionId('SRC-1'),
            locator: createEvidenceLocator('sec#1')
          }
        ],
        rationale: 'Updated'
      });
      await repo.saveRequirementRevision(rev2);

      // Attempting to freeze baseline targeting rev1 when rev2 is now head throws StaleRevisionTargetError
      const baseline = {
        id: baselineId,
        requirementRevisions: [rev1.id],
        policyConstraintRevisions: [],
        createdAt: now(),
        createdBy: createReviewerId('REV-1')
      };

      await expect(repo.saveRequirementsBaselineConditional(baseline, [rev1.id])).rejects.toThrow(
        StaleRevisionTargetError
      );
    });

    it('throws BlockedByOpenFindingsError when OPEN candidate findings affect revision in lineage closure', async () => {
      const baselineId = createRequirementsBaselineId('BASE-ADV-003');
      const reqId = createRequirementId('REQ-ADV-003');
      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-ADV-003-R1'),
        requirementId: reqId,
        revision: 1,
        statement: 'Statement 1',
        category: 'business-rule',
        origin: 'EXPLICIT',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR',
        evidence: [
          {
            sourceRevisionId: createSourceRevisionId('SRC-1'),
            locator: createEvidenceLocator('sec#1')
          }
        ],
        rationale: 'Initial'
      });
      await repo.saveRequirementRevision(rev1);

      // Record an OPEN finding affecting rev1
      const finding = createCandidateFinding({
        id: createFindingId('FIND-BLOCK-001'),
        type: 'contradiction',
        affectedRequirementRevisions: [rev1.id],
        evidence: [
          {
            sourceRevisionId: createSourceRevisionId('SRC-1'),
            locator: createEvidenceLocator('sec#1')
          }
        ],
        discoveredBy: 'model',
        disposition: 'OPEN'
      });
      await repo.saveCandidateFinding(finding);

      const baseline = {
        id: baselineId,
        requirementRevisions: [rev1.id],
        policyConstraintRevisions: [],
        createdAt: now(),
        createdBy: createReviewerId('REV-1')
      };

      await expect(repo.saveRequirementsBaselineConditional(baseline, [rev1.id])).rejects.toThrow(
        BlockedByOpenFindingsError
      );
    });
  });

  describe('Optimistic Concurrency Control OCC Verification (F-d3cd87c9)', () => {
    it('throws OptimisticConcurrencyConflictError when updateStory detects version mismatch', async () => {
      const storyId = createStoryId('STORY-OCC-001');
      const baselineId = createRequirementsBaselineId('BASE-OCC-001');
      const reqRevId = createRequirementRevisionId('REQ-REV-OCC-001');

      await repo.saveStory({
        id: storyId,
        baselineId,
        projectionId: 'PROJ-OCC-STORY',
        title: 'Story 1',
        narrative: { role: 'User', feature: 'F', benefit: 'B' },
        requirementRevisionIds: [reqRevId],
        scenarios: [],
        acceptanceCriteria: ['AC1'],
        gherkinText: 'Feature: F',
        metadata: {
          baselineId,
          requirementRevisionIds: [reqRevId],
          artifactType: 'stories',
          declaredProvenance: { baselineId, requirementRevisionIds: [reqRevId] },
          configuredExecution: { provider: 'fake', artifactType: 'stories' },
          measuredVerification: {
            repairsNeeded: 0,
            attemptCount: 1,
            contentHash: 'h',
            verifiedAt: now()
          }
        },
        createdAt: now(),
        dependencies: []
      });

      const existingStory = await repo.getStory(storyId);
      expect(existingStory).toBeDefined();

      // Update with matching expectedVersion: 1 succeeds
      await repo.updateStory(
        {
          ...existingStory!,
          title: 'Story 1 Updated'
        },
        1
      );

      // Subsequent update with stale expectedVersion: 1 throws OptimisticConcurrencyConflictError
      await expect(
        repo.updateStory(
          {
            ...existingStory!,
            title: 'Story 1 Conflicting Update'
          },
          1
        )
      ).rejects.toThrow(OptimisticConcurrencyConflictError);
    });

    it('throws OptimisticConcurrencyConflictError when updateProjectionRecord detects version mismatch', async () => {
      const projId = 'PROJ-OCC-001';
      const baselineId = createRequirementsBaselineId('BASE-OCC-002');
      const reqRevId = createRequirementRevisionId('REQ-REV-OCC-002');

      await repo.saveProjectionRecord({
        id: projId,
        baselineId,
        requirementRevisionIds: [reqRevId],
        artifactType: 'stories',
        content: 'Original projection content',
        metadata: {
          baselineId,
          requirementRevisionIds: [reqRevId],
          artifactType: 'stories',
          declaredProvenance: { baselineId, requirementRevisionIds: [reqRevId] },
          configuredExecution: { provider: 'fake', artifactType: 'stories' },
          measuredVerification: {
            repairsNeeded: 0,
            attemptCount: 1,
            contentHash: 'h',
            verifiedAt: now()
          }
        },
        createdAt: now()
      });

      const existing = await repo.getProjectionRecord(projId);
      expect(existing).toBeDefined();

      // Update with matching expectedVersion: 1 succeeds
      await repo.updateProjectionRecord(
        {
          ...existing!,
          content: 'Updated projection content'
        },
        1
      );

      // Subsequent update with stale expectedVersion: 1 throws OptimisticConcurrencyConflictError
      await expect(
        repo.updateProjectionRecord(
          {
            ...existing!,
            content: 'Conflicting projection content'
          },
          1
        )
      ).rejects.toThrow(OptimisticConcurrencyConflictError);
    });
  });
});
