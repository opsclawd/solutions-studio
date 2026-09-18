import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSourceId } from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeGenerationGateway } from '../fakes/FakeGenerationGateway.js';
import { CompileRequirementsUseCase } from '../../src/application/use-cases/CompileRequirementsUseCase.js';
import { loadFixture } from '../evaluation/support/loadFixture.js';

describe('CompileRequirementsUseCase Fixture Compatibility', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let fakeGateway: FakeGenerationGateway;
  let useCase: CompileRequirementsUseCase;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'compile-fixture-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    fakeGateway = new FakeGenerationGateway();
    useCase = new CompileRequirementsUseCase(fakeGateway, repo);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('runs successfully against unmodified #7 fixture: missing-authorization-basic', async () => {
    const loaded = loadFixture('missing-authorization-basic');
    const sourceDef = loaded.fixture.sources[0];
    const sourceRev = loaded.sourceRevisions.get(sourceDef.sourceRevisionId);
    expect(sourceRev).toBeDefined();

    // Capture source revision into repository using unmodified fixture source text
    const record = await repo.captureSourceRevision({
      sourceId: createSourceId(sourceDef.sourceId),
      sourceType: sourceDef.sourceType,
      markdownText: sourceRev!.text
    });

    // Verify convention matches fixture's declared revision ID
    expect(record.revision.id).toBe(sourceDef.sourceRevisionId);

    // Verify fixture's declared locator exists in the persisted locator index
    const expectedLocators = loaded.fixture.expectedRequirements.flatMap((r) =>
      r.evidence.map((e) => e.locator)
    );
    for (const loc of expectedLocators) {
      const resolved = await repo.resolveLocator(record.revision.id, loc);
      expect(resolved).toBeDefined();
    }

    // Build gateway response directly from fixture expected.json ground truth
    const scriptedResponse = {
      requirements: loaded.fixture.expectedRequirements.map((r) => ({
        requirementKey: r.requirementKey,
        statement:
          'When the Purge Organization Data action is triggered, the system permanently removes all databases and credentials.',
        category: r.category,
        origin: r.origin,
        evidence: r.evidence.map((e) => ({
          sourceRevisionId: e.sourceRevisionId,
          locator: e.locator
        }))
      })),
      findings: loaded.fixture.expectedFindings.map((f) => ({
        findingKey: f.findingKey,
        type: f.type,
        relatedRequirementKeys: [...f.relatedRequirementKeys],
        evidence: f.evidence.map((e) => ({
          sourceRevisionId: e.sourceRevisionId,
          locator: e.locator
        })),
        rationale: f.rationale
      }))
    };

    fakeGateway.queueResponse(JSON.stringify(scriptedResponse));

    const result = await useCase.compile({
      sourceRevisionIds: [record.revision.id]
    });

    expect(result.rejectedRequirements).toHaveLength(0);
    expect(result.rejectedFindings).toHaveLength(0);
    expect(result.acceptedRequirementRevisions).toHaveLength(
      loaded.fixture.expectedRequirements.length
    );
    expect(result.acceptedFindingIds).toHaveLength(loaded.fixture.expectedFindings.length);

    // Verify persisted requirement
    const savedReq = await repo.getRequirementRevision(result.acceptedRequirementRevisions[0]);
    expect(savedReq).toBeDefined();
    expect(savedReq!.reviewState).toBe('PENDING');
    expect(savedReq!.resolutionState).toBe('UNRESOLVED');
    expect(savedReq!.evidence[0].locator).toBe('permanent-data-purge#3.1');

    // Verify persisted finding
    const savedFinding = await repo.getCandidateFinding(result.acceptedFindingIds[0]);
    expect(savedFinding).toBeDefined();
    expect(savedFinding!.type).toBe('missing-authorization');
    expect(savedFinding!.discoveredBy).toBe('model');
    expect(savedFinding!.disposition).toBe('OPEN');
    expect(savedFinding!.affectedRequirementRevisions).toContain(
      result.acceptedRequirementRevisions[0]
    );
  });

  it('runs successfully against unmodified #7 fixture: approval-threshold-contradiction-basic', async () => {
    const loaded = loadFixture('approval-threshold-contradiction-basic');
    const sourceDef = loaded.fixture.sources[0];
    const sourceRev = loaded.sourceRevisions.get(sourceDef.sourceRevisionId);
    expect(sourceRev).toBeDefined();

    const record = await repo.captureSourceRevision({
      sourceId: createSourceId(sourceDef.sourceId),
      sourceType: sourceDef.sourceType,
      markdownText: sourceRev!.text
    });

    expect(record.revision.id).toBe(sourceDef.sourceRevisionId);

    const scriptedResponse = {
      requirements: loaded.fixture.expectedRequirements.map((r, idx) => ({
        requirementKey: r.requirementKey,
        statement:
          idx === 0
            ? 'Expenditures up to and including $50,000 may be authorized by the Team Manager without Department Vice President approval.'
            : 'Any expenditure greater than $25,000 must receive explicit written sign-off from the Department Vice President.',
        category: r.category,
        origin: r.origin,
        evidence: r.evidence.map((e) => ({
          sourceRevisionId: e.sourceRevisionId,
          locator: e.locator
        }))
      })),
      findings: loaded.fixture.expectedFindings.map((f) => ({
        findingKey: f.findingKey,
        type: f.type,
        relatedRequirementKeys: [...f.relatedRequirementKeys],
        evidence: f.evidence.map((e) => ({
          sourceRevisionId: e.sourceRevisionId,
          locator: e.locator
        })),
        rationale: f.rationale
      }))
    };

    fakeGateway.queueResponse(JSON.stringify(scriptedResponse));

    const result = await useCase.compile({
      sourceRevisionIds: [record.revision.id]
    });

    expect(result.rejectedRequirements).toHaveLength(0);
    expect(result.rejectedFindings).toHaveLength(0);
    expect(result.acceptedRequirementRevisions).toHaveLength(2);
    expect(result.acceptedFindingIds).toHaveLength(1);

    const finding = await repo.getCandidateFinding(result.acceptedFindingIds[0]);
    expect(finding).toBeDefined();
    expect(finding!.type).toBe('contradiction');
    expect(finding!.affectedRequirementRevisions).toHaveLength(2);
    expect(finding!.affectedRequirementRevisions).toEqual(
      expect.arrayContaining([...result.acceptedRequirementRevisions])
    );

    const savedReq0 = await repo.getRequirementRevision(result.acceptedRequirementRevisions[0]);
    const savedReq1 = await repo.getRequirementRevision(result.acceptedRequirementRevisions[1]);
    expect(savedReq0?.category).toBe('business-rule');
    expect(savedReq1?.category).toBe('business-rule');
  });

  it('runs successfully against unmodified #7 fixture: approval-threshold-contradiction-cross-source', async () => {
    const loaded = loadFixture('approval-threshold-contradiction-cross-source');
    const records = [];
    for (const sourceDef of loaded.fixture.sources) {
      const sourceRev = loaded.sourceRevisions.get(sourceDef.sourceRevisionId);
      expect(sourceRev).toBeDefined();
      const record = await repo.captureSourceRevision({
        sourceId: createSourceId(sourceDef.sourceId),
        sourceType: sourceDef.sourceType,
        markdownText: sourceRev!.text
      });
      records.push(record);
    }

    const scriptedResponse = {
      requirements: loaded.fixture.expectedRequirements.map((r) => ({
        requirementKey: r.requirementKey,
        statement:
          r.requirementKey === 'REQ-FIN-01'
            ? 'All capital expenditure commitments exceeding $10,000 require formal CFO sign-off prior to commitment.'
            : 'Operations Director may approve emergency field equipment acquisitions up to $50,000 without CFO review.',
        category: r.category,
        origin: r.origin,
        evidence: r.evidence.map((e) => ({
          sourceRevisionId: e.sourceRevisionId,
          locator: e.locator
        }))
      })),
      findings: loaded.fixture.expectedFindings.map((f) => ({
        findingKey: f.findingKey,
        type: f.type,
        relatedRequirementKeys: [...f.relatedRequirementKeys],
        evidence: f.evidence.map((e) => ({
          sourceRevisionId: e.sourceRevisionId,
          locator: e.locator
        })),
        rationale: f.rationale
      }))
    };

    fakeGateway.queueResponse(JSON.stringify(scriptedResponse));

    const result = await useCase.compile({
      sourceRevisionIds: records.map((r) => r.revision.id)
    });

    expect(result.rejectedRequirements).toHaveLength(0);
    expect(result.rejectedFindings).toHaveLength(0);
    expect(result.acceptedRequirementRevisions).toHaveLength(2);
    expect(result.acceptedFindingIds).toHaveLength(1);

    const savedReq0 = await repo.getRequirementRevision(result.acceptedRequirementRevisions[0]);
    const savedReq1 = await repo.getRequirementRevision(result.acceptedRequirementRevisions[1]);
    expect(savedReq0?.category).toBe('business-rule');
    expect(savedReq1?.category).toBe('business-rule');

    const finding = await repo.getCandidateFinding(result.acceptedFindingIds[0]);
    expect(finding).toBeDefined();
    expect(finding!.type).toBe('contradiction');
    expect(finding!.affectedRequirementRevisions).toHaveLength(2);
    expect(finding!.affectedRequirementRevisions).toEqual(
      expect.arrayContaining([...result.acceptedRequirementRevisions])
    );
  });
});
