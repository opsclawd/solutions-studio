import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  createRequirementId,
  createRequirementRevisionId,
  createRequirementsBaselineId,
  createReviewerId,
  createSourceId,
  createRequirementRevision,
  createRequirementsBaseline,
  DomainError,
  InvalidBaselineMembershipError
} from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { RecordRequirementsDiscoveryUseCase } from '../../src/application/use-cases/RecordRequirementsDiscoveryUseCase.js';
import { CreateRequirementsBaselineUseCase } from '../../src/application/use-cases/CreateRequirementsBaselineUseCase.js';
import { ReconcileRequirementsUseCase } from '../../src/application/use-cases/ReconcileRequirementsUseCase.js';
import {
  RationaleRequiredError,
  UnknownRequirementsBaselineError,
  UnknownRequirementRevisionError,
  BlockedByOpenFindingsError,
  UnauditedRequirementRevisionError
} from '../../src/application/use-cases/ReconciliationErrors.js';
import {
  UnknownSourceRevisionError,
  UnresolvedLocatorError
} from '../../src/application/use-cases/CompileRequirementsErrors.js';
import {
  UnknownProjectionError,
  ProjectionBaselineMismatchError,
  RequirementAlreadyExistsError
} from '../../src/application/use-cases/DiscoveryErrors.js';
import type { ProjectionRecord } from '../../src/application/ports/persistence/IRequirementsRepository.js';

describe('RecordRequirementsDiscoveryUseCase', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let useCase: RecordRequirementsDiscoveryUseCase;
  let baselineUseCase: CreateRequirementsBaselineUseCase;
  let reconcileUseCase: ReconcileRequirementsUseCase;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'discovery-usecase-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    useCase = new RecordRequirementsDiscoveryUseCase(repo);
    baselineUseCase = new CreateRequirementsBaselineUseCase(repo);
    reconcileUseCase = new ReconcileRequirementsUseCase(repo);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function seedBaselineAndProjection(baselineIdStr = 'BASELINE-001', projIdStr = 'PROJ-001') {
    const rev = createRequirementRevision({
      id: createRequirementRevisionId('REQ-EXISTING-R1'),
      requirementId: createRequirementId('REQ-EXISTING'),
      revision: 1,
      statement: 'Existing baseline requirement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: []
    });
    await repo.saveRequirementRevision(rev);
    await repo.appendReconciliationRecord({
      id: `REC-${randomUUID()}`,
      entityType: 'requirement',
      entityId: rev.requirementId,
      requirementRevisionId: rev.id,
      action: 'ACCEPT',
      previousReviewState: undefined,
      newReviewState: 'ACCEPTED',
      rationale: 'Initial acceptance',
      recordedAt: '2026-01-01T00:00:00.000Z' as any
    });

    const baselineId = createRequirementsBaselineId(baselineIdStr);
    const baseline = createRequirementsBaseline({
      id: baselineId,
      requirements: [rev],
      createdBy: createReviewerId('reviewer-1')
    });
    await repo.saveRequirementsBaseline(baseline);

    const projection: ProjectionRecord = {
      id: projIdStr,
      baselineId,
      requirementRevisionIds: [rev.id],
      artifactType: 'process-diagram',
      content: 'graph TD; A-->B;',
      metadata: {
        baselineId: baselineIdStr,
        requirementRevisionIds: [rev.id],
        artifactType: 'process-diagram',
        declaredProvenance: {
          baselineId: baselineIdStr,
          requirementRevisionIds: [rev.id]
        },
        configuredExecution: {
          provider: 'agy',
          artifactType: 'process-diagram'
        },
        measuredVerification: {
          repairsNeeded: 0,
          attemptCount: 1,
          contentHash: 'hash123',
          verifiedAt: '2026-01-01T00:00:00.000Z' as any
        }
      },
      createdAt: '2026-01-01T00:00:00.000Z' as any
    };
    await repo.saveProjectionRecord(projection);

    return { baseline, projection, rev };
  }

  describe('AC-1: Human observation can create a persisted REVIEWER_PROPOSAL requirement', () => {
    it('creates requirement with REVIEWER_PROPOSAL origin, revision 1, PENDING and UNRESOLVED states', async () => {
      const result = await useCase.recordRequirementDiscovery({
        statement: 'Tenant purge must retain audit records for 90 days',
        category: 'business-rule',
        rationale: 'Identified during SME interview with compliance team',
        actorId: 'reviewer-sme-1'
      });

      expect(result.origin).toBe('REVIEWER_PROPOSAL');
      expect(result.revision).toBe(1);
      expect(result.reviewState).toBe('PENDING');
      expect(result.resolutionState).toBe('UNRESOLVED');
      expect(result.statement).toBe('Tenant purge must retain audit records for 90 days');
      expect(result.category).toBe('business-rule');
      expect(result.rationale).toBe('Identified during SME interview with compliance team');
      expect(result.actorId).toBe('reviewer-sme-1');
      expect(result.id).toMatch(/^REQ-[a-f0-9-]+-R1$/);

      // Verify persistence in repository
      const persisted = await repo.getRequirementRevision(result.id);
      expect(persisted).toBeDefined();
      expect(persisted?.origin).toBe('REVIEWER_PROPOSAL');
      expect(persisted?.statement).toBe(result.statement);
    });

    it('generates unique requirement and revision IDs when omitted', async () => {
      const res1 = await useCase.recordRequirementDiscovery({
        statement: 'First discovery',
        category: 'business-rule',
        rationale: 'First rationale'
      });
      const res2 = await useCase.recordRequirementDiscovery({
        statement: 'Second discovery',
        category: 'business-rule',
        rationale: 'Second rationale'
      });

      expect(res1.id).not.toBe(res2.id);
      expect(res1.requirementId).not.toBe(res2.requirementId);
    });

    it('accepts custom valid requirementId and revisionId if not yet existing', async () => {
      const result = await useCase.recordRequirementDiscovery({
        statement: 'Custom ID statement',
        category: 'business-rule',
        rationale: 'Custom ID rationale',
        requirementId: 'REQ-CUSTOM-99',
        revisionId: 'REQ-CUSTOM-99-R1'
      });

      expect(result.requirementId).toBe('REQ-CUSTOM-99');
      expect(result.id).toBe('REQ-CUSTOM-99-R1');

      const persisted = await repo.getRequirementRevision(result.id);
      expect(persisted?.id).toBe('REQ-CUSTOM-99-R1');
    });
  });

  describe('AC-2 & AC-3: Artifact & Human Finding Discoveries', () => {
    it('creates an artifact-validation finding with OPEN disposition and persists it', async () => {
      const { projection } = await seedBaselineAndProjection();

      const finding = await useCase.recordFindingDiscovery({
        type: 'incomplete-state-machine',
        discoveredBy: 'artifact-validation',
        rationale: 'State diagram review revealed missing error state transition',
        originatingProjectionId: projection.id,
        actorId: 'validator-bot'
      });

      expect(finding.discoveredBy).toBe('artifact-validation');
      expect(finding.disposition).toBe('OPEN');
      expect(finding.type).toBe('incomplete-state-machine');
      expect(finding.rationale).toBe(
        'State diagram review revealed missing error state transition'
      );
      expect(finding.originatingProjectionId).toBe(projection.id);
      expect(finding.baselineId).toBe(projection.baselineId); // Backfilled from projection
      expect(finding.actorId).toBe('validator-bot');

      const persisted = await repo.getCandidateFinding(finding.id);
      expect(persisted).toBeDefined();
      expect(persisted?.discoveredBy).toBe('artifact-validation');
      expect(persisted?.disposition).toBe('OPEN');
    });

    it('creates a human finding with OPEN disposition and persists it', async () => {
      const finding = await useCase.recordFindingDiscovery({
        type: 'missing-authorization',
        discoveredBy: 'human',
        rationale: 'Security lead noticed lack of 2FA requirement for admin actions',
        actorId: 'sec-lead-1'
      });

      expect(finding.discoveredBy).toBe('human');
      expect(finding.disposition).toBe('OPEN');
      expect(finding.type).toBe('missing-authorization');
      expect(finding.actorId).toBe('sec-lead-1');

      const persisted = await repo.getCandidateFinding(finding.id);
      expect(persisted?.id).toBe(finding.id);
      expect(persisted?.discoveredBy).toBe('human');
    });

    it('rejects disallowed discoveredBy values such as model or heuristic', async () => {
      await expect(
        useCase.recordFindingDiscovery({
          type: 'contradiction',
          discoveredBy: 'model' as any,
          rationale: 'Should not be allowed for discovery capture'
        })
      ).rejects.toThrow(DomainError);

      await expect(
        useCase.recordFindingDiscovery({
          type: 'contradiction',
          discoveredBy: 'heuristic' as any,
          rationale: 'Should not be allowed for discovery capture'
        })
      ).rejects.toThrow(DomainError);
    });
  });

  describe('AC-4: Discovery authority & baseline gate invariants', () => {
    it('proves that a newly recorded REVIEWER_PROPOSAL cannot bypass reconciliation to enter a baseline', async () => {
      const proposal = await useCase.recordRequirementDiscovery({
        statement: 'Proposed un-reconciled requirement',
        category: 'business-rule',
        rationale: 'Reviewer suggested this rule'
      });

      // Attempting to include it in a baseline fails at domain membership gate (reviewState !== ACCEPTED)
      await expect(
        baselineUseCase.create({
          requirementRevisionIds: [proposal.id],
          createdBy: 'reviewer-1'
        })
      ).rejects.toThrow(InvalidBaselineMembershipError);

      // Even if someone manually created a revision with ACCEPTED state without reconciliation history:
      const spoofedRev = createRequirementRevision({
        id: createRequirementRevisionId('REQ-SPOOF-R1'),
        requirementId: createRequirementId('REQ-SPOOF'),
        revision: 1,
        statement: 'Spoofed accepted requirement',
        category: 'business-rule',
        origin: 'REVIEWER_PROPOSAL',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR',
        evidence: []
      });
      await repo.saveRequirementRevision(spoofedRev);

      // CreateRequirementsBaselineUseCase rejects it because reconciliation audit history is missing
      await expect(
        baselineUseCase.create({
          requirementRevisionIds: [spoofedRev.id],
          createdBy: 'reviewer-1'
        })
      ).rejects.toThrow(UnauditedRequirementRevisionError);
    });

    it('allows a reconciled proposal into a subsequent baseline after explicit human acceptance', async () => {
      const proposal = await useCase.recordRequirementDiscovery({
        statement: 'Proposed requirement to be accepted',
        category: 'business-rule',
        rationale: 'Discovered during prototype review'
      });

      // Reconcile via acceptRequirement
      const acceptedRev = await reconcileUseCase.acceptRequirement({
        revisionId: proposal.id,
        rationale: 'Human SME confirmed this is correct and necessary',
        actorId: 'sme-lead'
      });

      expect(acceptedRev.reviewState).toBe('ACCEPTED');

      // Resolve requirement to CLEAR state
      const clearedRev = await reconcileUseCase.resolveRequirement({
        revisionId: acceptedRev.id,
        rationale: 'No ambiguities or open conflicts remaining',
        actorId: 'sme-lead'
      });

      expect(clearedRev.resolutionState).toBe('CLEAR');

      // Reconciled proposal can now create a baseline successfully
      const baseline = await baselineUseCase.create({
        requirementRevisionIds: [clearedRev.id],
        createdBy: 'sme-lead'
      });

      expect(baseline.requirementRevisions).toContain(clearedRev.id);
    });

    it('proves that an OPEN finding discovered against a requirement blocks baseline freeze', async () => {
      const { rev } = await seedBaselineAndProjection('BASELINE-ORIG', 'PROJ-ORIG');

      // Discover an OPEN finding affecting rev.id
      const finding = await useCase.recordFindingDiscovery({
        type: 'missing-authorization',
        discoveredBy: 'artifact-validation',
        rationale: 'Flaw found during artifact review',
        affectedRequirementRevisions: [rev.id]
      });

      // Attempting to create a new baseline containing rev.id is blocked by open finding
      await expect(
        baselineUseCase.create({
          requirementRevisionIds: [rev.id],
          createdBy: 'reviewer-1'
        })
      ).rejects.toThrow(BlockedByOpenFindingsError);

      // Explicit human dispositioning clears the blocker
      await reconcileUseCase.dispositionFinding({
        findingId: finding.id,
        disposition: 'RESOLVED',
        rationale: 'Remediated authorization check',
        actorId: 'auditor-1'
      });

      // Now baseline creation succeeds
      const newBaseline = await baselineUseCase.create({
        requirementRevisionIds: [rev.id],
        createdBy: 'reviewer-1'
      });
      expect(newBaseline.requirementRevisions).toContain(rev.id);
    });
  });

  describe('AC-5: Context & Provenance Preservation', () => {
    it('automatically backfills baselineId when originatingProjectionId is provided without baselineId', async () => {
      const { projection } = await seedBaselineAndProjection();

      const req = await useCase.recordRequirementDiscovery({
        statement: 'Discovered from projection',
        category: 'business-rule',
        rationale: 'Found looking at diagram',
        originatingProjectionId: projection.id
      });

      expect(req.originatingProjectionId).toBe(projection.id);
      expect(req.baselineId).toBe(projection.baselineId);

      const finding = await useCase.recordFindingDiscovery({
        type: 'incomplete-state-machine',
        discoveredBy: 'artifact-validation',
        rationale: 'Diagram gap',
        originatingProjectionId: projection.id
      });

      expect(finding.originatingProjectionId).toBe(projection.id);
      expect(finding.baselineId).toBe(projection.baselineId);
    });

    it('succeeds when matching baselineId and originatingProjectionId are both provided', async () => {
      const { projection, baseline } = await seedBaselineAndProjection();

      const req = await useCase.recordRequirementDiscovery({
        statement: 'Discovered with matching baseline',
        category: 'business-rule',
        rationale: 'Valid matching references',
        baselineId: baseline.id,
        originatingProjectionId: projection.id
      });

      expect(req.baselineId).toBe(baseline.id);
      expect(req.originatingProjectionId).toBe(projection.id);
    });

    it('throws ProjectionBaselineMismatchError when baselineId does not match projection.baselineId', async () => {
      const { projection } = await seedBaselineAndProjection('BASELINE-A', 'PROJ-A');

      await expect(
        useCase.recordRequirementDiscovery({
          statement: 'Mismatched statement',
          category: 'business-rule',
          rationale: 'Some rationale',
          baselineId: 'BASELINE-DIFFERENT',
          originatingProjectionId: projection.id
        })
      ).rejects.toThrow(ProjectionBaselineMismatchError);
    });
  });

  describe('AC-6: Reference Validation & Error Handling', () => {
    it('rejects empty or whitespace-only rationale with RationaleRequiredError', async () => {
      await expect(
        useCase.recordRequirementDiscovery({
          statement: 'Valid statement',
          category: 'business-rule',
          rationale: '   '
        })
      ).rejects.toThrow(RationaleRequiredError);

      await expect(
        useCase.recordFindingDiscovery({
          type: 'contradiction',
          discoveredBy: 'human',
          rationale: ''
        })
      ).rejects.toThrow(RationaleRequiredError);
    });

    it('rejects caller-supplied requirementId that already exists with RequirementAlreadyExistsError', async () => {
      const { rev } = await seedBaselineAndProjection();

      await expect(
        useCase.recordRequirementDiscovery({
          statement: 'Duplicate requirement proposal',
          category: 'business-rule',
          rationale: 'Trying to reuse existing ID',
          requirementId: rev.requirementId
        })
      ).rejects.toThrow(RequirementAlreadyExistsError);
    });

    it('rejects non-existent baselineId with UnknownRequirementsBaselineError', async () => {
      await expect(
        useCase.recordRequirementDiscovery({
          statement: 'Statement',
          category: 'business-rule',
          rationale: 'Rationale',
          baselineId: 'BASELINE-NONEXISTENT'
        })
      ).rejects.toThrow(UnknownRequirementsBaselineError);

      await expect(
        useCase.recordFindingDiscovery({
          type: 'contradiction',
          discoveredBy: 'human',
          rationale: 'Rationale',
          baselineId: 'BASELINE-NONEXISTENT'
        })
      ).rejects.toThrow(UnknownRequirementsBaselineError);
    });

    it('rejects non-existent originatingProjectionId with UnknownProjectionError', async () => {
      await expect(
        useCase.recordRequirementDiscovery({
          statement: 'Statement',
          category: 'business-rule',
          rationale: 'Rationale',
          originatingProjectionId: 'PROJ-NONEXISTENT'
        })
      ).rejects.toThrow(UnknownProjectionError);

      await expect(
        useCase.recordFindingDiscovery({
          type: 'contradiction',
          discoveredBy: 'artifact-validation',
          rationale: 'Rationale',
          originatingProjectionId: 'PROJ-NONEXISTENT'
        })
      ).rejects.toThrow(UnknownProjectionError);
    });

    it('rejects non-existent affectedRequirementRevisions with UnknownRequirementRevisionError', async () => {
      await expect(
        useCase.recordFindingDiscovery({
          type: 'contradiction',
          discoveredBy: 'human',
          rationale: 'Rationale',
          affectedRequirementRevisions: ['REQ-DOES-NOT-EXIST-R1']
        })
      ).rejects.toThrow(UnknownRequirementRevisionError);
    });

    it('rejects non-existent dependency requirement with UnknownRequirementRevisionError', async () => {
      await expect(
        useCase.recordRequirementDiscovery({
          statement: 'Statement with missing dependency',
          category: 'business-rule',
          rationale: 'Rationale',
          dependencies: ['REQ-UNKNOWN-DEP']
        })
      ).rejects.toThrow(UnknownRequirementRevisionError);
    });

    it('validates evidence references and rejects missing source or unresolvable locator', async () => {
      // 1. Missing source revision
      await expect(
        useCase.recordRequirementDiscovery({
          statement: 'Statement with missing source',
          category: 'business-rule',
          rationale: 'Rationale',
          evidence: [{ sourceRevisionId: 'SRC-UNKNOWN-R1', locator: 'overview#1' }]
        })
      ).rejects.toThrow(UnknownSourceRevisionError);

      // 2. Existing source revision with unresolvable locator
      const source = await repo.captureSourceRevision({
        sourceId: createSourceId('SRC-001'),
        sourceType: 'sop',
        markdownText: '# Heading\n\nSome body text here.'
      });

      await expect(
        useCase.recordRequirementDiscovery({
          statement: 'Statement with bad locator',
          category: 'business-rule',
          rationale: 'Rationale',
          evidence: [{ sourceRevisionId: source.revision.id, locator: 'nonexistent-heading#99' }]
        })
      ).rejects.toThrow(UnresolvedLocatorError);

      // 3. Valid locator succeeds
      const success = await useCase.recordRequirementDiscovery({
        statement: 'Statement with valid locator',
        category: 'business-rule',
        rationale: 'Rationale',
        evidence: [
          { sourceRevisionId: source.revision.id, locator: source.locatorIndex[0].locator }
        ]
      });
      expect(success.evidence).toHaveLength(1);
    });
  });
});
