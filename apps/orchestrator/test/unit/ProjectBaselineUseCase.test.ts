import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createRequirementId,
  createRequirementRevisionId,
  createRequirementsBaselineId,
  createReviewerId,
  createInstant,
  createRequirementsBaseline,
  createRequirementRevision,
  EmptyBaselineError
} from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeGenerationGateway } from '../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../fakes/FakeMermaidLinterGateway.js';
import { FakePrototypeValidatorGateway } from '../fakes/FakePrototypeValidatorGateway.js';
import { GenerateArtifactUseCase } from '../../src/application/use-cases/GenerateArtifactUseCase.js';
import { GeneratePrototypeProjectionUseCase } from '../../src/application/use-cases/GeneratePrototypeProjectionUseCase.js';
import { ProjectBaselineUseCase } from '../../src/application/use-cases/ProjectBaselineUseCase.js';
import { UnknownRequirementsBaselineError } from '../../src/application/use-cases/ReconciliationErrors.js';

describe('ProjectBaselineUseCase', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let fakeGateway: FakeGenerationGateway;
  let fakeLinter: FakeMermaidLinterGateway;
  let fakeValidator: FakePrototypeValidatorGateway;
  let generateArtifactUseCase: GenerateArtifactUseCase;
  let generatePrototypeProjectionUseCase: GeneratePrototypeProjectionUseCase;
  let projectBaselineUseCase: ProjectBaselineUseCase;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-baseline-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    fakeGateway = new FakeGenerationGateway();
    fakeLinter = new FakeMermaidLinterGateway();
    fakeValidator = new FakePrototypeValidatorGateway();
    generateArtifactUseCase = new GenerateArtifactUseCase(fakeGateway, fakeLinter);
    generatePrototypeProjectionUseCase = new GeneratePrototypeProjectionUseCase(
      fakeGateway,
      fakeValidator,
      repo,
      'fake'
    );
    projectBaselineUseCase = new ProjectBaselineUseCase(
      generateArtifactUseCase,
      repo,
      'fake',
      generatePrototypeProjectionUseCase
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('projects a verified RequirementsBaseline by ID into a Mermaid diagram and persists projection metadata', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Valve must auto-close if pressure exceeds 900 PSI',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-001'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD'),
      createdAt: createInstant('2026-09-16T12:00:00.000Z')
    });
    await repo.saveRequirementsBaseline(baseline);

    const validDiagram = '```mermaid\ngraph TD\n  Start --> CloseValve\n```';
    fakeGateway.queueResponse(validDiagram);

    const result = await projectBaselineUseCase.project({
      baselineId: baseline.id,
      artifactType: 'process-diagram'
    });

    expect(result.content).toBe('graph TD\n  Start --> CloseValve');
    expect(result.metadata.baselineId).toBe('BASE-001');
    expect(result.metadata.requirementRevisionIds).toEqual([rev1.id]);
    expect(result.metadata.declaredProvenance.baselineId).toBe('BASE-001');
    expect(result.metadata.declaredProvenance.requirementRevisionIds).toEqual([rev1.id]);
    expect(result.metadata.configuredExecution.provider).toBe('fake');
    expect(result.metadata.configuredExecution.artifactType).toBe('process-diagram');
    expect(result.metadata.measuredVerification.contentHash).toBeDefined();
    expect(result.metadata.measuredVerification.repairsNeeded).toBe(0);

    // Verify persisted record in repository
    const reloaded = await repo.getProjectionRecord(result.projectionId);
    expect(reloaded).toBeDefined();
    expect(reloaded!.baselineId).toBe('BASE-001');
    expect(reloaded!.requirementRevisionIds).toEqual([rev1.id]);
    expect(reloaded!.content).toBe(result.content);
    expect(reloaded!.metadata.declaredProvenance.baselineId).toBe('BASE-001');
  });

  it('rejects with UnknownRequirementsBaselineError when baseline is not found in repository', async () => {
    await expect(
      projectBaselineUseCase.project({
        baselineId: 'NONEXISTENT-BASE-ID',
        artifactType: 'process-diagram'
      })
    ).rejects.toThrow(UnknownRequirementsBaselineError);
  });

  it('rejects with EmptyBaselineError when baseline has no requirement revisions', async () => {
    // Construct a baseline object with empty revisions bypassing the factory
    const emptyBaseline = {
      id: createRequirementsBaselineId('BASE-EMPTY'),
      requirementRevisions: [] as any[],
      createdAt: createInstant('2026-09-16T12:00:00.000Z'),
      createdBy: createReviewerId('REV-LEAD')
    };
    await repo.saveRequirementsBaseline(emptyBaseline);

    await expect(
      projectBaselineUseCase.project({
        baselineId: 'BASE-EMPTY',
        artifactType: 'process-diagram'
      })
    ).rejects.toThrow(EmptyBaselineError);
  });

  it('reuses existing closed-loop repair mechanism when candidate diagram has syntax errors', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-002-R1'),
      requirementId: createRequirementId('REQ-002'),
      revision: 1,
      statement: 'System transitions from idle to active',
      category: 'lifecycle-state',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-002'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    // First response is invalid
    fakeGateway.queueResponse('graph TD\n  Broken --> ;');
    // Second response is repaired valid diagram
    fakeGateway.queueResponse('graph TD\n  Idle --> Active');

    const result = await projectBaselineUseCase.project({
      baselineId: baseline.id,
      artifactType: 'state-diagram'
    });

    expect(result.content).toBe('graph TD\n  Idle --> Active');
    expect(result.metadata.measuredVerification.repairsNeeded).toBe(1);
    expect(result.metadata.measuredVerification.attemptCount).toBe(2);
    expect(result.repairHistory.length).toBe(1);
  });

  it('isolates projection inputs so a newer requirement revision cannot alter an original baseline projection', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-003-R1'),
      requirementId: createRequirementId('REQ-003'),
      revision: 1,
      statement: 'Historical original requirement statement for REQ-003',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline1 = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-HISTORICAL'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-HISTORICAL')
    });
    await repo.saveRequirementsBaseline(baseline1);

    // Save newer revision R2 for the same requirement REQ-003
    const rev2 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-003-R2'),
      requirementId: createRequirementId('REQ-003'),
      revision: 2,
      supersedes: rev1.id,
      statement: 'Newer mutated statement for REQ-003 in subsequent cycle',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev2);

    fakeGateway.queueResponse('graph TD\n  HistoricalStart --> HistoricalEnd\n');

    const result = await projectBaselineUseCase.project({
      baselineId: baseline1.id,
      artifactType: 'process-diagram'
    });

    // Verify prompt generated from baseline1 contains rev1 statement and NOT rev2 statement
    expect(fakeGateway.recordedRequests.length).toBe(1);
    const sentPrompt = fakeGateway.recordedRequests[0].prompt;
    expect(sentPrompt).toContain('Historical original requirement statement for REQ-003');
    expect(sentPrompt).not.toContain('Newer mutated statement for REQ-003 in subsequent cycle');

    // Verify metadata explicitly references baseline1 and rev1, not rev2
    expect(result.metadata.baselineId).toBe('BASE-HISTORICAL');
    expect(result.metadata.requirementRevisionIds).toEqual([rev1.id]);
    expect(result.metadata.requirementRevisionIds).not.toContain(rev2.id);
    expect(result.metadata.declaredProvenance.requirementRevisionIds).toEqual([rev1.id]);
  });

  it('retrieves projection by ID using getProjection', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-004-R1'),
      requirementId: createRequirementId('REQ-004'),
      revision: 1,
      statement: 'Requirement for lookup',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-LOOKUP'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LOOKUP')
    });
    await repo.saveRequirementsBaseline(baseline);

    fakeGateway.queueResponse('graph TD\n  LookupStart --> LookupEnd\n');

    const result = await projectBaselineUseCase.project({
      baselineId: baseline.id,
      artifactType: 'process-diagram',
      id: 'PROJ-TEST-LOOKUP'
    });

    const fetched = await projectBaselineUseCase.getProjection('PROJ-TEST-LOOKUP');
    expect(fetched).toBeDefined();
    expect(fetched?.id).toBe('PROJ-TEST-LOOKUP');
    expect(fetched?.baselineId).toBe('BASE-LOOKUP');
    expect(fetched?.content).toBe(result.content);

    const nonExistent = await projectBaselineUseCase.getProjection('PROJ-NON-EXISTENT');
    expect(nonExistent).toBeUndefined();
  });

  it('delegates prototype artifactType to GeneratePrototypeProjectionUseCase and returns projection result', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-005-R1'),
      requirementId: createRequirementId('REQ-005'),
      revision: 1,
      statement: 'Interactive dashboard displays active telemetry',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-PROTO-01'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    const protoCode = [
      '/**',
      ' * @baseline BASE-PROTO-01',
      ' * @requirements REQ-005-R1',
      ' */',
      "import React from 'react';",
      'export default function Dashboard() { return <div>Telemetry</div>; }'
    ].join('\n');

    fakeGateway.queueResponse(protoCode);

    const result = await projectBaselineUseCase.project({
      baselineId: baseline.id,
      artifactType: 'prototype'
    });

    expect(result.content).toBe(protoCode);
    expect(result.metadata.artifactType).toBe('prototype');
    expect(result.metadata.baselineId).toBe('BASE-PROTO-01');
    expect(result.metadata.declaredProvenance.baselineId).toBe('BASE-PROTO-01');
    expect(result.metadata.declaredProvenance.requirementRevisionIds).toEqual(['REQ-005-R1']);

    const reloaded = await repo.getProjectionRecord(result.projectionId);
    expect(reloaded).toBeDefined();
    expect(reloaded?.artifactType).toBe('prototype');
  });
});
