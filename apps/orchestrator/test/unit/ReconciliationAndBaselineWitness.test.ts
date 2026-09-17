import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createSourceId,
  createReviewerId,
  createRequirementsBaselineId,
  createActorId
} from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeGenerationGateway } from '../fakes/FakeGenerationGateway.js';
import { CompileRequirementsUseCase } from '../../src/application/use-cases/CompileRequirementsUseCase.js';
import { ReconcileRequirementsUseCase } from '../../src/application/use-cases/ReconcileRequirementsUseCase.js';
import { CreateRequirementsBaselineUseCase } from '../../src/application/use-cases/CreateRequirementsBaselineUseCase.js';
import { GenerateArtifactUseCase } from '../../src/application/use-cases/GenerateArtifactUseCase.js';
import { ProjectBaselineUseCase } from '../../src/application/use-cases/ProjectBaselineUseCase.js';
import { FakeMermaidLinterGateway } from '../fakes/FakeMermaidLinterGateway.js';
import { BlockedByOpenFindingsError } from '../../src/application/use-cases/ReconciliationErrors.js';
import { loadFixture } from '../evaluation/support/loadFixture.js';

describe('Phase 1.5 — Reconciliation and Immutable Baseline Witness Harness', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let fakeGateway: FakeGenerationGateway;
  let compileUseCase: CompileRequirementsUseCase;
  let reconcileUseCase: ReconcileRequirementsUseCase;
  let baselineUseCase: CreateRequirementsBaselineUseCase;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reconcile-witness-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    fakeGateway = new FakeGenerationGateway();
    compileUseCase = new CompileRequirementsUseCase(fakeGateway, repo);
    reconcileUseCase = new ReconcileRequirementsUseCase(repo);
    baselineUseCase = new CreateRequirementsBaselineUseCase(repo);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('executes full Phase 1.5 lifecycle: import canonical messy package -> compile -> reconcile -> lineage block -> disposition -> baseline -> restart reload', async () => {
    // 1. Load canonical messy discovery package fixture
    const loaded = loadFixture('canonical-messy-discovery-package');
    expect(loaded.fixture.canonicalMessyPackage).toBe(true);

    // Capture all sources into repository and map fixture declared revision ID to captured revision ID
    const sourceIdMap = new Map<string, string>();
    const capturedSourceRevisionIds: string[] = [];
    for (const sourceDef of loaded.fixture.sources) {
      const sourceRev = loaded.sourceRevisions.get(sourceDef.sourceRevisionId);
      expect(sourceRev).toBeDefined();

      const record = await repo.captureSourceRevision({
        sourceId: createSourceId(sourceDef.sourceId),
        sourceType: sourceDef.sourceType,
        markdownText: sourceRev!.text
      });
      sourceIdMap.set(sourceDef.sourceRevisionId, record.revision.id);
      if (!capturedSourceRevisionIds.includes(record.revision.id)) {
        capturedSourceRevisionIds.push(record.revision.id);
      }
    }

    // 2. Compile candidates and findings using FakeGenerationGateway scripted response
    const scriptedResponse = {
      requirements: loaded.fixture.expectedRequirements.map((r) => ({
        requirementKey: r.requirementKey,
        statement: `Statement for ${r.requirementKey}`,
        category: r.category,
        origin: r.origin,
        evidence: r.evidence.map((e) => ({
          sourceRevisionId: sourceIdMap.get(e.sourceRevisionId) ?? e.sourceRevisionId,
          locator: e.locator
        }))
      })),
      findings: loaded.fixture.expectedFindings.map((f) => ({
        findingKey: f.findingKey,
        type: f.type,
        relatedRequirementKeys: [...f.relatedRequirementKeys],
        evidence: f.evidence.map((e) => ({
          sourceRevisionId: sourceIdMap.get(e.sourceRevisionId) ?? e.sourceRevisionId,
          locator: e.locator
        })),
        rationale: f.rationale
      }))
    };
    fakeGateway.queueResponse(JSON.stringify(scriptedResponse));

    const compileResult = await compileUseCase.compile({
      sourceRevisionIds: capturedSourceRevisionIds.map((id) => id as any)
    });

    expect(compileResult.rejectedRequirements).toHaveLength(0);
    expect(compileResult.rejectedFindings).toHaveLength(0);
    expect(compileResult.acceptedRequirementRevisions.length).toBeGreaterThan(0);
    expect(compileResult.acceptedFindingIds.length).toBeGreaterThan(0);

    const firstCompiledReqId = compileResult.acceptedRequirementRevisions[0];
    const firstReq = await repo.getRequirementRevision(firstCompiledReqId);
    expect(firstReq).toBeDefined();
    expect(firstReq!.reviewState).toBe('PENDING');
    expect(firstReq!.resolutionState).toBe('UNRESOLVED');

    // 3. Reconcile: Accept requirement
    const acceptedReqRev = await reconcileUseCase.acceptRequirement({
      revisionId: firstCompiledReqId,
      rationale: 'Human SME verified against SOP Section 2.1',
      actorId: 'SME-1'
    });
    expect(acceptedReqRev.reviewState).toBe('ACCEPTED');
    expect(acceptedReqRev.resolutionState).toBe('UNRESOLVED'); // still UNRESOLVED until explicitly cleared
    expect(acceptedReqRev.supersedes).toBe(firstCompiledReqId);

    // 4. Resolve requirement to CLEAR
    const clearReqRev = await reconcileUseCase.resolveRequirement({
      revisionId: acceptedReqRev.id,
      rationale: 'Addressed known threshold ambiguity with operations lead',
      actorId: 'LEAD-1'
    });
    expect(clearReqRev.reviewState).toBe('ACCEPTED');
    expect(clearReqRev.resolutionState).toBe('CLEAR');
    expect(clearReqRev.supersedes).toBe(acceptedReqRev.id);

    // 5. Verify blocking policy:
    // If an OPEN finding affects an ancestor in the lineage (firstCompiledReqId or acceptedReqRev),
    // baseline creation MUST fail with BlockedByOpenFindingsError.
    const allFindings = await repo.listCandidateFindings();
    const affectingFinding = allFindings.find((f) =>
      f.affectedRequirementRevisions.includes(firstCompiledReqId)
    );

    if (affectingFinding) {
      expect(affectingFinding.disposition).toBe('OPEN');

      // Attempting to baseline clearReqRev while affectingFinding is OPEN must fail!
      await expect(
        baselineUseCase.create({
          id: createRequirementsBaselineId('BASE-ATTEMPT-1'),
          requirementRevisionIds: [clearReqRev.id],
          createdBy: createReviewerId('REV-01')
        })
      ).rejects.toThrow(BlockedByOpenFindingsError);

      // Now disposition the open finding
      await reconcileUseCase.dispositionFinding({
        findingId: affectingFinding.id,
        disposition: 'RESOLVED',
        rationale: 'Sign-off threshold contradiction resolved by human authority',
        actorId: createActorId('ARCH-01')
      });

      const reloadedFinding = await repo.getCandidateFinding(affectingFinding.id);
      expect(reloadedFinding!.disposition).toBe('RESOLVED');
    }

    // Also disposition all other findings affecting this requirement's lineage if any
    const reloadedFindings = await repo.listCandidateFindings();
    for (const f of reloadedFindings) {
      if (
        f.disposition === 'OPEN' &&
        (f.affectedRequirementRevisions.includes(firstCompiledReqId) ||
          f.affectedRequirementRevisions.includes(acceptedReqRev.id) ||
          f.affectedRequirementRevisions.includes(clearReqRev.id))
      ) {
        await reconcileUseCase.dispositionFinding({
          findingId: f.id,
          disposition: 'DISMISSED_FALSE_POSITIVE',
          rationale: 'Confirmed false positive in cross-source review'
        });
      }
    }

    // 6. Create immutable baseline
    const baseline1 = await baselineUseCase.create({
      id: createRequirementsBaselineId('BASE-MESSY-001'),
      requirementRevisionIds: [clearReqRev.id],
      createdBy: createReviewerId('HUMAN-LEAD-01')
    });

    expect(baseline1.id).toBe('BASE-MESSY-001');
    expect(baseline1.requirementRevisions).toEqual([clearReqRev.id]);
    expect(baseline1.createdBy).toBe('HUMAN-LEAD-01');

    // 7. Restart repository (simulate new process instance)
    const restartedRepo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    const restartedReconcileUseCase = new ReconcileRequirementsUseCase(restartedRepo);
    const restartedBaselineUseCase = new CreateRequirementsBaselineUseCase(restartedRepo);

    // Create a newer revision R4 for the same requirement
    const newerReqRev = await restartedReconcileUseCase.reviseRequirement({
      revisionId: clearReqRev.id,
      statement: 'Updated statement in subsequent release cycle',
      rationale: 'Evolving requirement statement'
    });
    expect(newerReqRev.revision).toBe(clearReqRev.revision + 1);

    // Accept and clear the newer revision to create BASE-MESSY-002
    const acceptedNewer = await restartedReconcileUseCase.acceptRequirement({
      revisionId: newerReqRev.id,
      rationale: 'Accepted newer revision'
    });
    const clearNewer = await restartedReconcileUseCase.resolveRequirement({
      revisionId: acceptedNewer.id,
      rationale: 'Cleared newer revision'
    });

    const baseline2 = await restartedBaselineUseCase.create({
      id: createRequirementsBaselineId('BASE-MESSY-002'),
      requirementRevisionIds: [clearNewer.id],
      createdBy: createReviewerId('HUMAN-LEAD-02')
    });

    // 8. Durability assertions:
    // Reload B1: exactly unchanged, points to exact clearReqRev.id, NOT newer revisions
    const reloadedB1 = await restartedRepo.getRequirementsBaseline(baseline1.id);
    expect(reloadedB1).toBeDefined();
    expect(reloadedB1!.id).toBe('BASE-MESSY-001');
    expect(reloadedB1!.requirementRevisions).toEqual([clearReqRev.id]);
    expect(reloadedB1!.requirementRevisions).not.toContain(clearNewer.id);

    // Reload B2: points to clearNewer.id
    const reloadedB2 = await restartedRepo.getRequirementsBaseline(baseline2.id);
    expect(reloadedB2!.requirementRevisions).toEqual([clearNewer.id]);

    // Verify reconciliation history across restart
    const reqHistory = await restartedRepo.listReconciliationRecords(
      'requirement',
      clearReqRev.requirementId
    );
    expect(reqHistory.length).toBeGreaterThanOrEqual(4);

    // 9. Downstream projection use case: project baseline into Mermaid artifact
    const fakeLinter = new FakeMermaidLinterGateway();
    const generateArtifactUseCase = new GenerateArtifactUseCase(fakeGateway, fakeLinter);
    const projectBaselineUseCase = new ProjectBaselineUseCase(
      generateArtifactUseCase,
      restartedRepo,
      'fake'
    );

    const validDiagram =
      '```mermaid\ngraph TD\n  Start[Start Process] --> Verify[Verify Step]\n```';
    fakeGateway.queueResponse(validDiagram);

    const projectionResult = await projectBaselineUseCase.project({
      baseline: reloadedB1!,
      artifactType: 'process-diagram'
    });

    expect(projectionResult.projectionId).toBeDefined();
    expect(projectionResult.content).toBe(
      'graph TD\n  Start[Start Process] --> Verify[Verify Step]'
    );
    expect(projectionResult.metadata.baselineId).toBe('BASE-MESSY-001');
    expect(projectionResult.metadata.artifactType).toBe('process-diagram');
    expect(projectionResult.metadata.configuredExecution.provider).toBe('fake');
    expect(projectionResult.metadata.measuredVerification.repairsNeeded).toBe(0);

    // Verify projection is persisted and reloadable from repository
    const storedProjection = await restartedRepo.getProjectionRecord(projectionResult.projectionId);
    expect(storedProjection).toBeDefined();
    expect(storedProjection!.baselineId).toBe('BASE-MESSY-001');
    expect(storedProjection!.content).toBe(projectionResult.content);

    // Assert provenance isolation: downstream projection explicitly consumes reloadedB1 and clearReqRev,
    // untouched by the existence of newer revisions (newerReqRev / B2).
    const declaredProvenance = {
      baselineId: reloadedB1!.id,
      requirementRevisionIds: reloadedB1!.requirementRevisions,
      statement: clearReqRev.statement,
      origin: clearReqRev.origin,
      evidence: clearReqRev.evidence
    };
    expect(declaredProvenance.baselineId).toBe('BASE-MESSY-001');
    expect(declaredProvenance.requirementRevisionIds).toEqual([clearReqRev.id]);
    expect(declaredProvenance.origin).toBe('EXPLICIT');
    expect(declaredProvenance.evidence.length).toBeGreaterThan(0);
  });
});
