#!/usr/bin/env tsx
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createSourceId,
  createSourceRevisionId,
  createReviewerId,
  createRequirementsBaselineId,
  createActorId
} from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeGenerationGateway } from '../test/fakes/FakeGenerationGateway.js';
import { CompileRequirementsUseCase } from '../src/application/use-cases/CompileRequirementsUseCase.js';
import { ReconcileRequirementsUseCase } from '../src/application/use-cases/ReconcileRequirementsUseCase.js';
import { CreateRequirementsBaselineUseCase } from '../src/application/use-cases/CreateRequirementsBaselineUseCase.js';
import { GenerateArtifactUseCase } from '../src/application/use-cases/GenerateArtifactUseCase.js';
import { ProjectBaselineUseCase } from '../src/application/use-cases/ProjectBaselineUseCase.js';
import { FakeMermaidLinterGateway } from '../test/fakes/FakeMermaidLinterGateway.js';
import { BlockedByOpenFindingsError } from '../src/application/use-cases/ReconciliationErrors.js';
import { loadFixture } from '../test/evaluation/support/loadFixture.js';

async function main() {
  console.log('====================================================');
  console.log('Solutions Studio: Phase 1.5 Reconciliation & Baseline Harness');
  console.log('====================================================\n');

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reconcile-harness-run-'));
  try {
    const repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    const fakeGateway = new FakeGenerationGateway();
    const compileUseCase = new CompileRequirementsUseCase(fakeGateway, repo);
    const reconcileUseCase = new ReconcileRequirementsUseCase(repo);
    const baselineUseCase = new CreateRequirementsBaselineUseCase(repo);

    console.log('[1/7] Loading canonical messy discovery package...');
    const loaded = loadFixture('canonical-messy-discovery-package');
    const sourceIdMap = new Map<string, string>();
    const capturedSourceRevisionIds: string[] = [];

    for (const sourceDef of loaded.fixture.sources) {
      const sourceRev = loaded.sourceRevisions.get(sourceDef.sourceRevisionId);
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
    console.log(
      `      Captured ${capturedSourceRevisionIds.length} source revisions into repository.`
    );

    console.log('[2/7] Compiling candidate requirements and findings...');
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
      sourceRevisionIds: capturedSourceRevisionIds.map((id) => createSourceRevisionId(id))
    });
    console.log(
      `      Compiled ${compileResult.acceptedRequirementRevisions.length} candidate requirements and ${compileResult.acceptedFindingIds.length} findings.`
    );

    console.log('[3/7] Reconciling: Accepting and resolving requirement...');
    const firstReqId = compileResult.acceptedRequirementRevisions[0];
    const accepted = await reconcileUseCase.acceptRequirement({
      revisionId: firstReqId,
      rationale: 'Human SME verified against SOP',
      actorId: 'SME-1'
    });
    const cleared = await reconcileUseCase.resolveRequirement({
      revisionId: accepted.id,
      rationale: 'Addressed known threshold ambiguity',
      actorId: 'LEAD-1'
    });
    console.log(
      `      Accepted and resolved ${cleared.id} (origin: ${cleared.origin}, reviewState: ${cleared.reviewState}, resolutionState: ${cleared.resolutionState}).`
    );

    console.log('[4/7] Verifying deterministic Phase 1 blocking policy...');
    const allFindings = await repo.listCandidateFindings();
    const affecting = allFindings.find((f) => f.affectedRequirementRevisions.includes(firstReqId));
    if (affecting) {
      try {
        await baselineUseCase.create({
          id: createRequirementsBaselineId('BASE-BLOCKED'),
          requirementRevisionIds: [cleared.id],
          createdBy: createReviewerId('REV-01')
        });
        throw new Error('Expected BlockedByOpenFindingsError was not thrown!');
      } catch (err) {
        if (err instanceof BlockedByOpenFindingsError) {
          console.log(
            `      Deterministic block confirmed: Open finding '${affecting.id}' blocked baseline.`
          );
        } else {
          throw err;
        }
      }

      await reconcileUseCase.dispositionFinding({
        findingId: affecting.id,
        disposition: 'RESOLVED',
        rationale: 'Resolved by human authority',
        actorId: createActorId('ARCH-01')
      });
      console.log(`      Dispositioned finding '${affecting.id}' to RESOLVED with rationale.`);
    }

    // Disposition any remaining open findings on this requirement's lineage
    const remaining = await repo.listCandidateFindings();
    for (const f of remaining) {
      if (
        f.disposition === 'OPEN' &&
        (f.affectedRequirementRevisions.includes(firstReqId) ||
          f.affectedRequirementRevisions.includes(accepted.id) ||
          f.affectedRequirementRevisions.includes(cleared.id))
      ) {
        await reconcileUseCase.dispositionFinding({
          findingId: f.id,
          disposition: 'DISMISSED_FALSE_POSITIVE',
          rationale: 'Confirmed false positive in cross-source review'
        });
      }
    }

    console.log('[5/7] Creating immutable RequirementsBaseline...');
    const baseline = await baselineUseCase.create({
      id: createRequirementsBaselineId('BASE-MESSY-001'),
      requirementRevisionIds: [cleared.id],
      createdBy: createReviewerId('HUMAN-LEAD-01')
    });
    console.log(
      `      Created baseline '${baseline.id}' containing exact revisions: [${baseline.requirementRevisions.join(', ')}].`
    );

    console.log('[6/7] Verifying repository restart reload durability...');
    const restartedRepo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    const reloaded = await restartedRepo.getRequirementsBaseline(baseline.id);
    if (
      !reloaded ||
      reloaded.id !== baseline.id ||
      reloaded.requirementRevisions[0] !== cleared.id
    ) {
      throw new Error('Baseline reload durability check failed!');
    }
    console.log(
      `      Restart reload verified: baseline '${reloaded.id}' is immutable and intact.`
    );

    console.log('[7/7] Projecting verified baseline to Mermaid process diagram...');
    const fakeLinter = new FakeMermaidLinterGateway();
    const generateArtifactUseCase = new GenerateArtifactUseCase(fakeGateway, fakeLinter);
    const projectBaselineUseCase = new ProjectBaselineUseCase(
      generateArtifactUseCase,
      restartedRepo,
      'fake'
    );
    fakeGateway.queueResponse(
      '```mermaid\ngraph TD\n  Start[Start Process] --> EndStep[End Step]\n```'
    );
    const projection = await projectBaselineUseCase.project({
      baseline: reloaded,
      artifactType: 'process-diagram'
    });
    const reloadedProjection = await restartedRepo.getProjectionRecord(projection.projectionId);
    if (!reloadedProjection || reloadedProjection.id !== projection.projectionId) {
      throw new Error('Projection reload durability check failed!');
    }
    console.log(
      `      Projection verified: record '${projection.projectionId}' generated with hash ${projection.metadata.measuredVerification.contentHash.slice(0, 8)}...\n`
    );

    console.log('====================================================');
    console.log('Phase 1.5 Reconciliation & Baseline Harness PASSED');
    console.log('====================================================');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('Fatal error running harness:', err);
  process.exit(1);
});
