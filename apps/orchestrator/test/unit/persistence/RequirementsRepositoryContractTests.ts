import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createSourceId,
  createRequirementId,
  createRequirementRevisionId,
  createFindingId,
  createRequirementsBaselineId,
  createReviewerId,
  createRequirementRevision,
  createCandidateFinding,
  createRequirementsBaseline,
  createEngineeringDecisionId,
  createEngineeringDecision,
  createStoryId,
  createValidationRunRecord,
  createCandidateApprovalRecord,
  revokeCandidateApprovalRecord,
  createActorId,
  createInstant,
  now
} from '@solutions-studio/domain';
import {
  ImmutableRecordConflictError,
  type IRequirementsRepository,
  type StoryRecord,
  type ProjectionRecord
} from '../../../src/application/ports/persistence/IRequirementsRepository.js';
import {
  StaleRevisionTargetError,
  FindingDispositionConflictError,
  RequirementRevisionConflictError,
  InvalidEngineeringDecisionStateError,
  BlockedByOpenFindingsError,
  InvalidBaselineMembershipError,
  OptimisticConcurrencyConflictError
} from '../../../src/application/use-cases/ReconciliationErrors.js';
import { computeContentHash } from '../../../src/infrastructure/persistence/markdown/deriveLocatorIndex.js';

export interface ContractTestContext {
  repo: IRequirementsRepository;
  cleanup: () => Promise<void>;
  reopen?: () => Promise<IRequirementsRepository>;
}

export function runRequirementsRepositoryContractTests(
  adapterName: string,
  createContext: () => Promise<ContractTestContext>
): void {
  describe(`RequirementsRepository Contract: ${adapterName}`, () => {
    let repo: IRequirementsRepository;
    let cleanup: () => Promise<void>;
    let reopen: (() => Promise<IRequirementsRepository>) | undefined;

    beforeEach(async () => {
      const ctx = await createContext();
      repo = ctx.repo;
      cleanup = ctx.cleanup;
      reopen = ctx.reopen;
    });

    afterEach(async () => {
      await cleanup();
    });

    describe('Source Revisions & Locators', () => {
      it('captures new source revision with content hash and revision=1', async () => {
        const md = `# Overview\n\nFirst paragraph.`;
        const sourceId = createSourceId('SRC-001');

        const record = await repo.captureSourceRevision({
          sourceId,
          sourceType: 'sop',
          markdownText: md
        });

        expect(record.revision.id).toBe('SRC-001-R1');
        expect(record.revision.sourceId).toBe(sourceId);
        expect(record.revision.revision).toBe(1);
        expect(record.revision.contentHash).toBe(computeContentHash(md));
        expect(record.revision.supersedes).toBeUndefined();
        expect(record.rawText).toBe(md);
        expect(record.locatorIndex.length).toBeGreaterThanOrEqual(1);

        const listed = await repo.listSourceRevisions(sourceId);
        expect(listed).toHaveLength(1);
        expect(listed[0].id).toBe('SRC-001-R1');

        const latest = await repo.getLatestSourceRevision(sourceId);
        expect(latest?.revision.id).toBe('SRC-001-R1');
        expect(record.sourceType).toBe('sop');
      });

      it('deduplicates identical source content and creates successor when modified', async () => {
        const md1 = `# Title\n\nContent version 1.`;
        const sourceId = createSourceId('SRC-DEDUP');

        const rec1 = await repo.captureSourceRevision({
          sourceId,
          sourceType: 'interview',
          markdownText: md1
        });
        expect(rec1.revision.revision).toBe(1);

        // Same content -> return existing revision
        const rec2 = await repo.captureSourceRevision({
          sourceId,
          sourceType: 'interview',
          markdownText: md1
        });
        expect(rec2.revision.id).toBe(rec1.revision.id);
        expect(rec2.revision.revision).toBe(1);

        // Modified content -> revision 2
        const md2 = `# Title\n\nContent version 2.`;
        const rec3 = await repo.captureSourceRevision({
          sourceId,
          sourceType: 'interview',
          markdownText: md2
        });
        expect(rec3.revision.id).toBe('SRC-DEDUP-R2');
        expect(rec3.revision.revision).toBe(2);
        expect(rec3.revision.supersedes).toBe('SRC-DEDUP-R1');

        const list = await repo.listSourceRevisions(sourceId);
        expect(list).toHaveLength(2);
      });

      it('resolves locators derived from source document', async () => {
        const md = `# Section One\n\nParagraph in section one.\n\n# Section Two\n\nParagraph in section two.`;
        const sourceId = createSourceId('SRC-LOC');

        const rec = await repo.captureSourceRevision({
          sourceId,
          sourceType: 'policy',
          markdownText: md
        });

        const locatorKey = rec.locatorIndex[0].locator;
        const resolved = await repo.resolveLocator(rec.revision.id, locatorKey);
        expect(resolved).toBeDefined();
        expect(resolved?.text).toBe(rec.locatorIndex[0].text);
      });
    });

    describe('Requirement Revisions & Transitions', () => {
      it('saves, retrieves, and lists requirement revisions', async () => {
        const reqId = createRequirementId('REQ-001');
        const revId = createRequirementRevisionId('REQ-001-R1');

        const rev = createRequirementRevision({
          id: revId,
          requirementId: reqId,
          revision: 1,
          statement: 'The system must validate persistence integrity.',
          category: 'business-rule',
          origin: 'EXPLICIT',
          reviewState: 'PENDING',
          resolutionState: 'UNRESOLVED',
          evidence: [],
          rationale: 'Initial captured requirement'
        });

        await repo.saveRequirementRevision(rev);

        const fetched = await repo.getRequirementRevision(revId);
        expect(fetched).toBeDefined();
        expect(fetched?.id).toBe(revId);
        expect(fetched?.statement).toBe(rev.statement);

        const list = await repo.listRequirementRevisions(reqId);
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe(revId);

        const ids = await repo.listRequirementIds();
        expect(ids).toContain(reqId);
      });

      it('transitions requirement revision and detects stale targets', async () => {
        const reqId = createRequirementId('REQ-OCC');
        const rev1Id = createRequirementRevisionId('REQ-OCC-R1');

        const rev1 = createRequirementRevision({
          id: rev1Id,
          requirementId: reqId,
          revision: 1,
          statement: 'Initial statement',
          category: 'business-rule',
          origin: 'EXPLICIT',
          reviewState: 'PENDING',
          resolutionState: 'UNRESOLVED',
          evidence: [],
          rationale: 'Init'
        });
        await repo.saveRequirementRevision(rev1);

        const rev2Id = createRequirementRevisionId('REQ-OCC-R2');
        const rev2 = createRequirementRevision({
          id: rev2Id,
          requirementId: reqId,
          revision: 2,
          statement: 'Accepted statement',
          category: 'business-rule',
          origin: 'EXPLICIT',
          reviewState: 'ACCEPTED',
          resolutionState: 'UNRESOLVED',
          evidence: [],
          rationale: 'Accepted by reviewer',
          supersedes: rev1Id
        });

        await repo.transitionRequirementRevision(
          rev2,
          {
            id: 'REC-001',
            entityType: 'requirement',
            entityId: reqId,
            requirementRevisionId: rev2Id,
            action: 'ACCEPT',
            previousReviewState: undefined,
            newReviewState: 'ACCEPTED',
            rationale: 'Accepted by reviewer',
            recordedAt: now()
          },
          rev1Id
        );

        const fetched = await repo.getRequirementRevision(rev2Id);
        expect(fetched?.reviewState).toBe('ACCEPTED');

        // Conflicting transition attempting to transition from rev1 again
        const rev3ConflictId = createRequirementRevisionId('REQ-OCC-R3');
        const rev3Conflict = createRequirementRevision({
          id: rev3ConflictId,
          requirementId: reqId,
          revision: 2,
          statement: 'Conflicting statement',
          category: 'business-rule',
          origin: 'EXPLICIT',
          reviewState: 'REJECTED',
          resolutionState: 'UNRESOLVED',
          evidence: [],
          rationale: 'Rejected',
          supersedes: rev1Id
        });

        await expect(
          repo.transitionRequirementRevision(
            rev3Conflict,
            {
              id: 'REC-002',
              entityType: 'requirement',
              entityId: reqId,
              requirementRevisionId: rev3ConflictId,
              action: 'REJECT',
              previousReviewState: 'ACCEPTED',
              newReviewState: 'REJECTED',
              rationale: 'Rejected',
              recordedAt: now()
            },
            rev1Id
          )
        ).rejects.toThrow(RequirementRevisionConflictError);
      });
    });

    describe('Candidate Findings & OCC Transitions', () => {
      it('saves OPEN finding and transitions with audit log', async () => {
        const findingId = createFindingId('FIND-001');
        const finding = createCandidateFinding({
          id: findingId,
          type: 'temporal-ambiguity',
          affectedRequirementRevisions: [],
          evidence: [],
          discoveredBy: 'model',
          disposition: 'OPEN',
          rationale: 'Detected ambiguous language'
        });

        await repo.saveCandidateFinding(finding);

        const fetched = await repo.getCandidateFinding(findingId);
        expect(fetched).toBeDefined();
        expect(fetched?.disposition).toBe('OPEN');

        const updatedFinding = createCandidateFinding({
          ...finding,
          disposition: 'RESOLVED',
          rationale: 'Resolved by clarification'
        });

        await repo.transitionCandidateFinding(
          updatedFinding,
          {
            id: 'AUD-F-001',
            entityType: 'finding',
            entityId: findingId,
            previousDisposition: 'OPEN',
            newDisposition: 'RESOLVED',
            rationale: 'Resolved by clarification',
            recordedAt: now()
          },
          'OPEN'
        );

        const afterTransition = await repo.getCandidateFinding(findingId);
        expect(afterTransition?.disposition).toBe('RESOLVED');

        const audit = await repo.listReconciliationRecords('finding', findingId);
        expect(audit).toHaveLength(1);
        expect(audit[0].newDisposition).toBe('RESOLVED');
      });

      it('rejects concurrent conflicting finding transitions', async () => {
        const findingId = createFindingId('FIND-CONCURRENT');
        const finding = createCandidateFinding({
          id: findingId,
          type: 'contradiction',
          affectedRequirementRevisions: [],
          evidence: [],
          discoveredBy: 'model',
          disposition: 'OPEN',
          rationale: 'Open finding'
        });
        await repo.saveCandidateFinding(finding);

        // Attempt transition expecting 'RESOLVED' when current is 'OPEN'
        const candidateTransition = createCandidateFinding({
          ...finding,
          disposition: 'DISMISSED_FALSE_POSITIVE',
          rationale: 'Dismissed'
        });

        await expect(
          repo.transitionCandidateFinding(
            candidateTransition,
            {
              id: 'AUD-FAIL',
              entityType: 'finding',
              entityId: findingId,
              previousDisposition: 'RESOLVED', // Stale expected disposition!
              newDisposition: 'DISMISSED_FALSE_POSITIVE',
              rationale: 'Dismissed',
              recordedAt: now()
            },
            'RESOLVED'
          )
        ).rejects.toThrow(FindingDispositionConflictError);
      });
    });

    describe('Requirements Baselines & OCC Freeze', () => {
      it('creates frozen baseline and rejects stale requirement revision targets', async () => {
        const reqId = createRequirementId('REQ-BASE');
        const rev1Id = createRequirementRevisionId('REQ-BASE-R1');
        const rev1 = createRequirementRevision({
          id: rev1Id,
          requirementId: reqId,
          revision: 1,
          statement: 'Statement 1',
          category: 'business-rule',
          origin: 'REVIEWER_PROPOSAL',
          reviewState: 'ACCEPTED',
          resolutionState: 'CLEAR',
          evidence: [],
          rationale: 'Ready'
        });
        await repo.saveRequirementRevision(rev1);

        const baselineId = createRequirementsBaselineId('BASE-001');
        const baseline = createRequirementsBaseline({
          id: baselineId,
          requirements: [rev1],
          policyConstraints: [],
          createdAt: now(),
          createdBy: createReviewerId('REV-001')
        });

        // Freeze baseline with expected latest rev1
        await repo.saveRequirementsBaselineConditional(baseline, [rev1Id]);

        const fetched = await repo.getRequirementsBaseline(baselineId);
        expect(fetched).toBeDefined();
        expect(fetched?.requirementRevisions).toContain(rev1Id);

        // Advance requirement to rev2
        const rev2Id = createRequirementRevisionId('REQ-BASE-R2');
        const rev2 = createRequirementRevision({
          id: rev2Id,
          requirementId: reqId,
          revision: 2,
          statement: 'Statement 2',
          category: 'business-rule',
          origin: 'REVIEWER_PROPOSAL',
          reviewState: 'ACCEPTED',
          resolutionState: 'CLEAR',
          evidence: [],
          rationale: 'Updated',
          supersedes: rev1Id
        });
        await repo.transitionRequirementRevision(
          rev2,
          {
            id: 'REC-REV2',
            entityType: 'requirement',
            entityId: reqId,
            requirementRevisionId: rev2Id,
            action: 'REVISE',
            previousReviewState: undefined,
            newReviewState: 'ACCEPTED',
            previousResolutionState: 'CLEAR',
            newResolutionState: 'CLEAR',
            rationale: 'Updated',
            recordedAt: now()
          },
          rev1Id
        );

        // Attempt to create new baseline claiming rev1 is latest -> must reject!
        const staleBaseline = createRequirementsBaseline({
          id: createRequirementsBaselineId('BASE-STALE'),
          requirements: [rev1],
          policyConstraints: [],
          createdAt: now(),
          createdBy: createReviewerId('REV-001')
        });

        await expect(
          repo.saveRequirementsBaselineConditional(staleBaseline, [rev1Id])
        ).rejects.toThrow(StaleRevisionTargetError);
      });

      it('rejects baseline creation when manifest revisions differ from expected revisions', async () => {
        const reqId = createRequirementId('REQ-MANIFEST');
        const rev1Id = createRequirementRevisionId('REQ-MANIFEST-R1');
        const rev1 = createRequirementRevision({
          id: rev1Id,
          requirementId: reqId,
          revision: 1,
          statement: 'Statement 1',
          category: 'business-rule',
          origin: 'REVIEWER_PROPOSAL',
          reviewState: 'ACCEPTED',
          resolutionState: 'CLEAR',
          evidence: [],
          rationale: 'Ready'
        });
        await repo.saveRequirementRevision(rev1);

        const baseline = createRequirementsBaseline({
          id: createRequirementsBaselineId('BASE-MANIFEST-MISMATCH'),
          requirements: [rev1],
          policyConstraints: [],
          createdAt: now(),
          createdBy: createReviewerId('REV-001')
        });

        await expect(
          repo.saveRequirementsBaselineConditional(baseline, [
            createRequirementRevisionId('REQ-OTHER-R1')
          ])
        ).rejects.toThrow(InvalidBaselineMembershipError);

        await expect(
          repo.saveRequirementsBaselineConditional(baseline, [
            rev1Id,
            createRequirementRevisionId('REQ-EXTRA-R1')
          ])
        ).rejects.toThrow(InvalidBaselineMembershipError);
      });

      it('rejects baseline creation when open blocking findings affect revisions in manifest', async () => {
        const reqId = createRequirementId('REQ-FINDING-BLOCK');
        const rev1Id = createRequirementRevisionId('REQ-FINDING-BLOCK-R1');
        const rev1 = createRequirementRevision({
          id: rev1Id,
          requirementId: reqId,
          revision: 1,
          statement: 'Statement 1',
          category: 'business-rule',
          origin: 'REVIEWER_PROPOSAL',
          reviewState: 'ACCEPTED',
          resolutionState: 'CLEAR',
          evidence: [],
          rationale: 'Ready'
        });
        await repo.saveRequirementRevision(rev1);

        const findingId = createFindingId('FIND-BLOCKING-001');
        const finding = createCandidateFinding({
          id: findingId,
          type: 'contradiction',
          affectedRequirementRevisions: [rev1Id],
          evidence: [],
          discoveredBy: 'model',
          disposition: 'OPEN',
          rationale: 'Contradiction identified'
        });
        await repo.saveCandidateFinding(finding);

        const baseline = createRequirementsBaseline({
          id: createRequirementsBaselineId('BASE-BLOCKING-FINDINGS'),
          requirements: [rev1],
          policyConstraints: [],
          createdAt: now(),
          createdBy: createReviewerId('REV-001')
        });

        await expect(repo.saveRequirementsBaselineConditional(baseline, [rev1Id])).rejects.toThrow(
          BlockedByOpenFindingsError
        );

        const resolvedFinding = createCandidateFinding({
          ...finding,
          disposition: 'RESOLVED',
          rationale: 'Resolved by reviewer'
        });
        await repo.transitionCandidateFinding(
          resolvedFinding,
          {
            id: 'REC-FIND-RESOLVE',
            entityType: 'finding',
            entityId: findingId,
            previousDisposition: 'OPEN',
            newDisposition: 'RESOLVED',
            rationale: 'Resolved by reviewer',
            recordedAt: now()
          },
          'OPEN'
        );

        await repo.saveRequirementsBaselineConditional(baseline, [rev1Id]);
        const saved = await repo.getRequirementsBaseline(baseline.id);
        expect(saved).toBeDefined();
        expect(saved?.id).toBe(baseline.id);
      });

      it('enforces mutual exclusion between concurrent baseline freeze and revision transition', async () => {
        const reqId = createRequirementId('REQ-CONCUR-FREEZE');
        const rev1Id = createRequirementRevisionId('REQ-CONCUR-FREEZE-R1');
        const rev1 = createRequirementRevision({
          id: rev1Id,
          requirementId: reqId,
          revision: 1,
          statement: 'Statement 1',
          category: 'business-rule',
          origin: 'REVIEWER_PROPOSAL',
          reviewState: 'ACCEPTED',
          resolutionState: 'CLEAR',
          evidence: [],
          rationale: 'Ready'
        });
        await repo.saveRequirementRevision(rev1);

        const rev2Id = createRequirementRevisionId('REQ-CONCUR-FREEZE-R2');
        const rev2 = createRequirementRevision({
          id: rev2Id,
          requirementId: reqId,
          revision: 2,
          statement: 'Statement 2',
          category: 'business-rule',
          origin: 'REVIEWER_PROPOSAL',
          reviewState: 'ACCEPTED',
          resolutionState: 'CLEAR',
          evidence: [],
          rationale: 'Advance revision',
          supersedes: rev1Id
        });

        const baseline = createRequirementsBaseline({
          id: createRequirementsBaselineId('BASE-CONCUR-FREEZE'),
          requirements: [rev1],
          policyConstraints: [],
          createdAt: now(),
          createdBy: createReviewerId('REV-001')
        });

        const freezePromise = repo.saveRequirementsBaselineConditional(baseline, [rev1Id]);
        const transitionPromise = repo.transitionRequirementRevision(
          rev2,
          {
            id: 'REC-CONCUR-REV2',
            entityType: 'requirement',
            entityId: reqId,
            requirementRevisionId: rev2Id,
            action: 'REVISE',
            previousReviewState: undefined,
            newReviewState: 'ACCEPTED',
            previousResolutionState: 'CLEAR',
            newResolutionState: 'CLEAR',
            rationale: 'Advancing revision concurrently',
            recordedAt: now()
          },
          rev1Id
        );

        const [freezeResult, transitionResult] = await Promise.allSettled([
          freezePromise,
          transitionPromise
        ]);

        if (freezeResult.status === 'rejected') {
          expect(freezeResult.reason).toBeInstanceOf(StaleRevisionTargetError);
          expect(transitionResult.status).toBe('fulfilled');
        } else {
          expect(freezeResult.status).toBe('fulfilled');
          expect(transitionResult.status).toBe('fulfilled');
        }
      });
    });

    describe('Engineering Decisions & OCC', () => {
      it('updates engineering decision and rejects on state mismatch', async () => {
        const decId = createEngineeringDecisionId('DEC-001');
        const baseId = createRequirementsBaselineId('BASE-001');

        const decision = createEngineeringDecision({
          id: decId,
          baselineId: baseId,
          statement: 'Use PostgreSQL for persistent storage.',
          rationale: 'ACID guarantees and mature ecosystem.',
          requirementRevisionIds: [],
          state: 'PROPOSED',
          createdAt: now(),
          createdBy: 'Architect'
        });
        await repo.saveEngineeringDecision(decision);

        const accepted = createEngineeringDecision({
          ...decision,
          state: 'ACCEPTED',
          acceptedBy: createReviewerId('TechLead'),
          acceptedAt: now(),
          transitionRationale: 'Approved for pilot'
        });

        await repo.updateEngineeringDecision(accepted, 'PROPOSED');

        const fetched = await repo.getEngineeringDecision(decId);
        expect(fetched?.state).toBe('ACCEPTED');

        // Conflicting update expecting PROPOSED when current is ACCEPTED
        await expect(
          repo.updateEngineeringDecision(
            {
              ...decision,
              state: 'REJECTED'
            },
            'PROPOSED'
          )
        ).rejects.toThrow(InvalidEngineeringDecisionStateError);
      });
    });

    describe('Stories, Projections & Atomic updateStoryAndProjection', () => {
      it('persists and atomically updates story and projection', async () => {
        const baseId = createRequirementsBaselineId('BASE-STORY');
        const projId = 'PROJ-STORY-1';
        const storyId = createStoryId('STORY-001');

        const projection: ProjectionRecord = {
          id: projId,
          baselineId: baseId,
          requirementRevisionIds: [],
          artifactType: 'stories',
          content: 'Story projection content v1',
          metadata: {
            baselineId: baseId,
            requirementRevisionIds: ['REQ-001-R1'],
            artifactType: 'stories',
            declaredProvenance: {
              baselineId: baseId,
              requirementRevisionIds: ['REQ-001-R1']
            },
            configuredExecution: {
              provider: 'fake',
              artifactType: 'stories'
            },
            measuredVerification: {
              repairsNeeded: 0,
              attemptCount: 1,
              contentHash: 'hash123',
              verifiedAt: now()
            }
          },
          createdAt: now()
        };

        const story: StoryRecord = {
          id: storyId,
          baselineId: baseId,
          projectionId: projId,
          title: 'Initial Story',
          narrative: {
            role: 'User',
            feature: 'Feature',
            benefit: 'Benefit'
          },
          requirementRevisionIds: [],
          scenarios: [],
          acceptanceCriteria: ['Must work'],
          gherkinText: 'Feature: Test\nScenario: One\nGiven x\nWhen y\nThen z',
          metadata: projection.metadata,
          createdAt: now(),
          dependencies: []
        };

        // First save projection then story (foreign key requirement)
        await repo.saveProjectionRecord(projection);
        await repo.saveStory(story);

        const updatedProjection: ProjectionRecord = {
          ...projection,
          content: 'Story projection content v2'
        };
        const updatedStory: StoryRecord = {
          ...story,
          title: 'Updated Story Title',
          dependencies: [createStoryId('STORY-DEP-1')]
        };

        await repo.updateStoryAndProjection(updatedStory, updatedProjection);

        const fetchedStory = await repo.getStory(storyId);
        expect(fetchedStory?.title).toBe('Updated Story Title');
        expect(fetchedStory?.dependencies).toEqual(['STORY-DEP-1']);

        const fetchedProj = await repo.getProjectionRecord(projId);
        expect(fetchedProj?.content).toBe('Story projection content v2');
      });

      it('enforces optimistic concurrency control version checks on updateStory, updateProjectionRecord, and updateStoryAndProjection', async () => {
        const baseId = createRequirementsBaselineId('BASE-OCC-TEST');
        const projId = 'PROJ-OCC-1';
        const storyId = createStoryId('STORY-OCC-1');

        const projection: ProjectionRecord = {
          id: projId,
          baselineId: baseId,
          requirementRevisionIds: [],
          artifactType: 'stories',
          content: 'Projection content v1',
          metadata: {
            baselineId: baseId,
            requirementRevisionIds: ['REQ-001-R1'],
            artifactType: 'stories',
            declaredProvenance: {
              baselineId: baseId,
              requirementRevisionIds: ['REQ-001-R1']
            },
            configuredExecution: {
              provider: 'fake',
              artifactType: 'stories'
            },
            measuredVerification: {
              repairsNeeded: 0,
              attemptCount: 1,
              contentHash: 'hash1',
              verifiedAt: now()
            }
          },
          createdAt: now()
        };

        const story: StoryRecord = {
          id: storyId,
          baselineId: baseId,
          projectionId: projId,
          title: 'Initial Story',
          narrative: {
            role: 'User',
            feature: 'Feature',
            benefit: 'Benefit'
          },
          requirementRevisionIds: [],
          scenarios: [],
          acceptanceCriteria: ['Must work'],
          gherkinText: 'Feature: Test',
          metadata: projection.metadata,
          createdAt: now(),
          dependencies: []
        };

        await repo.saveProjectionRecord(projection);
        await repo.saveStory(story);

        const initialStory = await repo.getStory(storyId);
        const initialProj = await repo.getProjectionRecord(projId);
        expect(initialStory?.version).toBe(1);
        expect(initialProj?.version).toBe(1);

        // 1. Valid updateStory increments version to 2
        await repo.updateStory({ ...story, title: 'Story v2' }, 1);
        const storyV2 = await repo.getStory(storyId);
        expect(storyV2?.version).toBe(2);

        // Stale updateStory throws OptimisticConcurrencyConflictError
        await expect(repo.updateStory({ ...story, title: 'Story v3' }, 1)).rejects.toThrow(
          OptimisticConcurrencyConflictError
        );

        // 2. Valid updateProjectionRecord increments version to 2
        await repo.updateProjectionRecord({ ...projection, content: 'Projection v2' }, 1);
        const projV2 = await repo.getProjectionRecord(projId);
        expect(projV2?.version).toBe(2);

        // Stale updateProjectionRecord throws OptimisticConcurrencyConflictError
        await expect(
          repo.updateProjectionRecord({ ...projection, content: 'Projection v3' }, 1)
        ).rejects.toThrow(OptimisticConcurrencyConflictError);

        // 3. updateStoryAndProjection with stale story version throws and rolls back projection
        await expect(
          repo.updateStoryAndProjection(
            { ...storyV2!, title: 'Story v3' },
            { ...projV2!, content: 'Projection v3' },
            { expectedStoryVersion: 1, expectedProjectionVersion: 2 } // Stale story version (1 vs current 2)
          )
        ).rejects.toThrow(OptimisticConcurrencyConflictError);

        // Verify neither story nor projection were updated
        const checkStory = await repo.getStory(storyId);
        const checkProj = await repo.getProjectionRecord(projId);
        expect(checkStory?.title).toBe('Story v2');
        expect(checkProj?.content).toBe('Projection v2');
      });
    });

    describe('Baseline Advisory Mutex withBaselineLock', () => {
      it('serializes operations and survives inner database commits', async () => {
        const baseId = createRequirementsBaselineId('BASE-LOCK-TEST');
        const order: number[] = [];

        // Baseline lock wrapping nested operations
        const p1 = repo.withBaselineLock(baseId, async () => {
          order.push(1);
          await new Promise((r) => setTimeout(r, 50));
          order.push(2);
          return 'done1';
        });

        const p2 = repo.withBaselineLock(baseId, async () => {
          order.push(3);
          await new Promise((r) => setTimeout(r, 10));
          order.push(4);
          return 'done2';
        });

        const results = await Promise.all([p1, p2]);
        expect(results).toEqual(['done1', 'done2']);
        // Verify mutual exclusion: [1, 2, 3, 4] rather than interleaved [1, 3, ...]
        expect(order).toEqual([1, 2, 3, 4]);
      });
    });

    describe('Governance Audit & Promotion Integrity', () => {
      const candidateSha = 'd5adf81ac2ba5acd7b7cd22c830f03e2258a63b4';
      const evidenceDigest = 'a'.repeat(64);
      const artifactHash = 'b'.repeat(64);

      const humanActor = {
        id: createActorId('ACTOR-HUMAN-01'),
        name: 'Jane Reviewer',
        email: 'jane@example.com',
        actorType: 'human' as const
      };

      it('saves and retrieves validation run with verified artifacts', async () => {
        const run = createValidationRunRecord({
          id: 'RUN-P4-001',
          candidateSha,
          executedAt: createInstant('2026-09-20T09:00:00Z'),
          executedBy: createActorId('RUNNER-01'),
          phase: 'phase-4',
          executionMode: 'deterministic-ci',
          provider: 'fake',
          artifacts: [
            {
              name: 'schema.sql',
              artifactType: 'sql-ddl',
              contentHash: artifactHash
            }
          ],
          evidenceDigest,
          proposedDisposition: 'GO',
          summary: { tests: 10 }
        });

        await repo.saveValidationRun(run);

        const fetched = await repo.getValidationRun('RUN-P4-001');
        expect(fetched).toBeDefined();
        expect(fetched?.id).toBe('RUN-P4-001');
        expect(fetched?.candidateSha).toBe(candidateSha);
        expect(fetched?.artifacts).toHaveLength(1);
        expect(fetched?.artifacts[0].contentHash).toBe(artifactHash);
        expect(fetched?.evidenceDigest).toBe(evidenceDigest);

        const latest = await repo.getLatestValidationRun(candidateSha);
        expect(latest?.id).toBe('RUN-P4-001');
      });

      it('rejects duplicate validation run ID with ImmutableRecordConflictError', async () => {
        const run = createValidationRunRecord({
          id: 'RUN-DUP-001',
          candidateSha,
          executedAt: createInstant('2026-09-20T09:00:00Z'),
          executedBy: createActorId('RUNNER-01'),
          phase: 'phase-4',
          executionMode: 'deterministic-ci',
          provider: 'fake',
          artifacts: [
            {
              name: 'schema.sql',
              artifactType: 'sql-ddl',
              contentHash: artifactHash
            }
          ],
          evidenceDigest
        });

        await repo.saveValidationRun(run);
        await expect(repo.saveValidationRun(run)).rejects.toThrow(ImmutableRecordConflictError);
      });

      it('saves and retrieves active governance approval record', async () => {
        const run = createValidationRunRecord({
          id: 'RUN-APPR-TEST-001',
          candidateSha,
          executedAt: createInstant('2026-09-20T09:00:00Z'),
          executedBy: createActorId('RUNNER-01'),
          phase: 'phase-4',
          executionMode: 'deterministic-ci',
          provider: 'fake',
          artifacts: [
            {
              name: 'schema.sql',
              artifactType: 'sql-ddl',
              contentHash: artifactHash
            }
          ],
          evidenceDigest
        });
        await repo.saveValidationRun(run);

        const approval = createCandidateApprovalRecord({
          id: 'APPR-001',
          candidateSha,
          validationRunId: run.id,
          evidenceDigest,
          decision: 'GO',
          actor: humanActor,
          decidedAt: createInstant('2026-09-20T10:00:00Z'),
          rationale: 'Verified all checks passed'
        });

        await repo.saveGovernanceApproval(approval);

        const fetched = await repo.getGovernanceApproval('APPR-001');
        expect(fetched).toBeDefined();
        expect(fetched?.id).toBe('APPR-001');
        expect(fetched?.status).toBe('ACTIVE');
        expect(fetched?.decision).toBe('GO');
        expect(fetched?.actor.name).toBe('Jane Reviewer');

        const active = await repo.getActiveGovernanceApproval(candidateSha);
        expect(active).toBeDefined();
        expect(active?.id).toBe('APPR-001');
      });

      it('enforces single active approval invariant: second active approval throws OptimisticConcurrencyConflictError', async () => {
        const run = createValidationRunRecord({
          id: 'RUN-ACTIVE-TEST-001',
          candidateSha,
          executedAt: createInstant('2026-09-20T09:00:00Z'),
          executedBy: createActorId('RUNNER-01'),
          phase: 'phase-4',
          executionMode: 'deterministic-ci',
          provider: 'fake',
          artifacts: [
            {
              name: 'schema.sql',
              artifactType: 'sql-ddl',
              contentHash: artifactHash
            }
          ],
          evidenceDigest
        });
        await repo.saveValidationRun(run);

        const approval1 = createCandidateApprovalRecord({
          id: 'APPR-FIRST-001',
          candidateSha,
          validationRunId: run.id,
          evidenceDigest,
          decision: 'GO',
          actor: humanActor,
          decidedAt: createInstant('2026-09-20T10:00:00Z'),
          rationale: 'First approval'
        });
        await repo.saveGovernanceApproval(approval1);

        const approval2 = createCandidateApprovalRecord({
          id: 'APPR-SECOND-002',
          candidateSha,
          validationRunId: run.id,
          evidenceDigest,
          decision: 'GO',
          actor: humanActor,
          decidedAt: createInstant('2026-09-20T10:05:00Z'),
          rationale: 'Second concurrent approval attempt'
        });

        await expect(repo.saveGovernanceApproval(approval2)).rejects.toThrow(
          OptimisticConcurrencyConflictError
        );
      });

      it('updates governance approval status under OCC checks', async () => {
        const run = createValidationRunRecord({
          id: 'RUN-OCC-TEST-001',
          candidateSha,
          executedAt: createInstant('2026-09-20T09:00:00Z'),
          executedBy: createActorId('RUNNER-01'),
          phase: 'phase-4',
          executionMode: 'deterministic-ci',
          provider: 'fake',
          artifacts: [
            {
              name: 'schema.sql',
              artifactType: 'sql-ddl',
              contentHash: artifactHash
            }
          ],
          evidenceDigest
        });
        await repo.saveValidationRun(run);

        const approval = createCandidateApprovalRecord({
          id: 'APPR-OCC-001',
          candidateSha,
          validationRunId: run.id,
          evidenceDigest,
          decision: 'GO',
          actor: humanActor,
          decidedAt: createInstant('2026-09-20T10:00:00Z'),
          rationale: 'Initial approval'
        });
        await repo.saveGovernanceApproval(approval);

        // Revoke approval
        const revoked = revokeCandidateApprovalRecord(
          approval,
          humanActor,
          'Security vulnerability reported'
        );

        // Attempt update with wrong expected status
        await expect(repo.updateGovernanceApproval(revoked, 'REVOKED')).rejects.toThrow(
          OptimisticConcurrencyConflictError
        );

        // Successful update with correct expected status
        await repo.updateGovernanceApproval(revoked, 'ACTIVE');

        const reloaded = await repo.getGovernanceApproval('APPR-OCC-001');
        expect(reloaded?.status).toBe('REVOKED');
        if (reloaded?.status === 'REVOKED') {
          expect(reloaded.revocation.rationale).toBe('Security vulnerability reported');
        }

        // Active approval for candidate should now be undefined
        const active = await repo.getActiveGovernanceApproval(candidateSha);
        expect(active).toBeUndefined();
      });

      it('replaces active governance approval atomically with OCC verification', async () => {
        const run = createValidationRunRecord({
          id: 'RUN-REPLACE-001',
          candidateSha,
          executedAt: createInstant('2026-09-20T09:00:00Z'),
          executedBy: createActorId('RUNNER-01'),
          phase: 'phase-4',
          executionMode: 'deterministic-ci',
          provider: 'fake',
          artifacts: [
            {
              name: 'schema.sql',
              artifactType: 'sql-ddl',
              contentHash: artifactHash
            }
          ],
          evidenceDigest
        });
        await repo.saveValidationRun(run);

        const initialApproval = createCandidateApprovalRecord({
          id: 'APPR-REP-001',
          candidateSha,
          validationRunId: run.id,
          evidenceDigest,
          decision: 'GO',
          actor: humanActor,
          decidedAt: createInstant('2026-09-20T10:00:00Z'),
          rationale: 'Initial approval'
        });

        // 1. Initial replacement with expectedActiveApprovalId = undefined succeeds
        await repo.replaceGovernanceApproval(initialApproval);
        const active1 = await repo.getActiveGovernanceApproval(candidateSha);
        expect(active1?.id).toBe('APPR-REP-001');

        // 2. Replacement without expectedActiveApprovalId when active exists fails with OCC
        const conflictingApproval = createCandidateApprovalRecord({
          id: 'APPR-REP-CONFLICT',
          candidateSha,
          validationRunId: run.id,
          evidenceDigest,
          decision: 'GO',
          actor: humanActor,
          decidedAt: createInstant('2026-09-20T10:05:00Z'),
          rationale: 'Conflicting approval attempt'
        });
        await expect(repo.replaceGovernanceApproval(conflictingApproval)).rejects.toThrow(
          OptimisticConcurrencyConflictError
        );

        // 3. Replacement with wrong expectedActiveApprovalId fails with OCC
        await expect(
          repo.replaceGovernanceApproval(conflictingApproval, 'APPR-WRONG-ID')
        ).rejects.toThrow(OptimisticConcurrencyConflictError);

        // 4. Superseding replacement with matching expectedActiveApprovalId succeeds atomically
        const supersedingApproval = createCandidateApprovalRecord({
          id: 'APPR-REP-002',
          candidateSha,
          validationRunId: run.id,
          evidenceDigest,
          decision: 'GO',
          actor: humanActor,
          decidedAt: createInstant('2026-09-20T10:10:00Z'),
          rationale: 'Superseding approval with matching ID',
          supersedes: 'APPR-REP-001'
        });
        await repo.replaceGovernanceApproval(supersedingApproval, 'APPR-REP-001');

        const active2 = await repo.getActiveGovernanceApproval(candidateSha);
        expect(active2?.id).toBe('APPR-REP-002');

        const previousReloaded = await repo.getGovernanceApproval('APPR-REP-001');
        expect(previousReloaded?.status).toBe('SUPERSEDED');
      });
    });

    if (reopen) {
      describe('Durability & Host Restart', () => {
        it('survives repo re-instantiation without data or identity drift', async () => {
          const reqId = createRequirementId('REQ-RESTART');
          const revId = createRequirementRevisionId('REQ-RESTART-R1');
          const rev = createRequirementRevision({
            id: revId,
            requirementId: reqId,
            revision: 1,
            statement: 'Must persist across restart',
            category: 'business-rule',
            origin: 'EXPLICIT',
            reviewState: 'PENDING',
            resolutionState: 'UNRESOLVED',
            evidence: [],
            rationale: 'Testing restart'
          });
          await repo.saveRequirementRevision(rev);

          // Close and reopen repo over same storage
          const reopenedRepo = await reopen!();

          const reloaded = await reopenedRepo.getRequirementRevision(revId);
          expect(reloaded).toBeDefined();
          expect(reloaded?.id).toBe(revId);
          expect(reloaded?.statement).toBe(rev.statement);
        });
      });
    }
  });
}
