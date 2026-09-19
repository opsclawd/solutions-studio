import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createRequirementId,
  createRequirementRevisionId,
  createRequirementsBaselineId,
  createPolicyConstraintId,
  createPolicyConstraintRevisionId,
  createReviewerId,
  createInstant,
  createRequirementsBaseline,
  createRequirementRevision,
  createPolicyConstraintRevision,
  EmptyBaselineError
} from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeGenerationGateway } from '../fakes/FakeGenerationGateway.js';
import { FakeGherkinValidatorGateway } from '../fakes/FakeGherkinValidatorGateway.js';
import { GenerateStoriesProjectionUseCase } from '../../src/application/use-cases/GenerateStoriesProjectionUseCase.js';
import { UnknownRequirementsBaselineError } from '../../src/application/use-cases/ReconciliationErrors.js';
import { RepairRetryExhaustionError } from '../../src/application/use-cases/SqlSchemaProjectionErrors.js';
import { ImmutableRecordConflictError } from '../../src/application/ports/persistence/IRequirementsRepository.js';

describe('GenerateStoriesProjectionUseCase', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let fakeGateway: FakeGenerationGateway;
  let fakeValidator: FakeGherkinValidatorGateway;
  let useCase: GenerateStoriesProjectionUseCase;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'story-proj-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    fakeGateway = new FakeGenerationGateway();
    fakeValidator = new FakeGherkinValidatorGateway();
    useCase = new GenerateStoriesProjectionUseCase(fakeGateway, fakeValidator, repo, 'fake');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function createValidGherkin(
    baselineId: string,
    reqIds: string[],
    options?: { polIds?: string[]; edIds?: string[]; extraComments?: string[] }
  ): string {
    const lines = [`# @baseline ${baselineId}`, `# @requirements ${reqIds.join(', ')}`];
    if (options?.polIds && options.polIds.length > 0) {
      lines.push(`# @policy-constraints ${options.polIds.join(', ')}`);
    }
    if (options?.edIds && options.edIds.length > 0) {
      lines.push(`# @engineering-decisions ${options.edIds.join(', ')}`);
    }
    if (options?.extraComments) {
      lines.push(...options.extraComments);
    }

    const polTag =
      options?.polIds && options.polIds.length > 0
        ? ` @policy-constraints:${options.polIds[0]}`
        : '';

    lines.push(
      '',
      'Feature: User Account Provisioning',
      '  As a verified actor',
      '  I want to create an account',
      '  So that I can access the system',
      '',
      `  @requirements:${reqIds[0]}${polTag}`,
      '  Scenario: Successful account creation',
      '    Given valid user details',
      '    When the account registration is submitted',
      '    Then the account is created successfully'
    );

    if (reqIds.length > 1) {
      lines.push(
        '',
        `  @requirements:${reqIds[1]}`,
        '  Scenario: Secondary account validation',
        '    Given existing user details',
        '    When duplicate registration is attempted',
        '    Then an error message is returned'
      );
    }

    return lines.join('\n');
  }

  it('generates a valid story projection on first attempt with exact traceability and persists both StoryRecord and ProjectionRecord', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Users must register with email',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const pol1 = createPolicyConstraintRevision({
      id: createPolicyConstraintRevisionId('POL-SEC-001-R1'),
      policyConstraintId: createPolicyConstraintId('POL-SEC-001'),
      revision: 1,
      statement: 'Password must meet complexity rules',
      authorityReference: 'SEC-POLICY-1',
      state: 'ACCEPTED',
      createdBy: 'sec-lead'
    });
    await repo.savePolicyConstraintRevision(pol1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-001'),
      requirements: [rev1],
      policyConstraints: [pol1],
      createdBy: createReviewerId('REV-LEAD'),
      createdAt: createInstant('2026-09-18T12:00:00.000Z')
    });
    await repo.saveRequirementsBaseline(baseline);

    const validGherkin = createValidGherkin('BASE-001', ['REQ-001-R1'], {
      polIds: ['POL-SEC-001-R1']
    });
    fakeGateway.queueResponse(`\`\`\`gherkin\n${validGherkin}\n\`\`\``);

    const result = await useCase.execute({
      baselineId: baseline.id
    });

    expect(result.projectionId).toBeDefined();
    expect(result.story).toBeDefined();
    expect(result.story.baselineId).toBe('BASE-001');
    expect(result.story.title).toBe('User Account Provisioning');
    expect(result.story.requirementRevisionIds).toEqual(['REQ-001-R1']);
    expect(result.story.policyConstraintRevisionIds).toEqual(['POL-SEC-001-R1']);
    expect(result.story.scenarios).toHaveLength(1);
    expect(result.story.scenarios[0].requirementRevisionIds).toEqual(['REQ-001-R1']);
    expect(result.story.scenarios[0].policyConstraintRevisionIds).toEqual(['POL-SEC-001-R1']);
    expect(result.metadata.measuredVerification.repairsNeeded).toBe(0);

    // Verify persisted StoryRecord
    const savedStory = await repo.getStory(result.story.id);
    expect(savedStory).toBeDefined();
    expect(savedStory?.id).toBe(result.story.id);
    expect(savedStory?.gherkinText).toBe(result.content);

    // Verify immutability: overwriting story fails
    await expect(repo.saveStory(savedStory!)).rejects.toThrow(ImmutableRecordConflictError);

    // Verify persisted ProjectionRecord with artifactType='stories'
    const savedProj = await repo.getProjectionRecord(result.projectionId);
    expect(savedProj).toBeDefined();
    expect(savedProj?.artifactType).toBe('stories');
  });

  it('repairs malformed Gherkin syntax via closed-loop repair', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'System must log audit events',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-001'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    // Attempt 0: Missing Feature declaration
    fakeGateway.queueResponse('Scenario: Bad scenario\n  Given a step');

    // Attempt 1: Valid Gherkin
    const validGherkin = createValidGherkin('BASE-001', ['REQ-001-R1']);
    fakeGateway.queueResponse(validGherkin);

    const result = await useCase.execute({
      baselineId: baseline.id
    });

    expect(result.metadata.measuredVerification.repairsNeeded).toBe(1);
    expect(result.repairHistory).toHaveLength(1);
    expect(result.repairHistory[0].attempt).toBe(0);
    expect(result.repairHistory[0].errorMessage).toContain("Missing 'Feature:' declaration");
  });

  it('enforces Traceability Invariant: repairs scenario lacking authority references', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'System must log audit events',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-001'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    // Attempt 0: Scenario missing requirement tag
    const untraceableGherkin = `
# @baseline BASE-001
# @requirements REQ-001-R1

Feature: Audit Logging
  As an admin
  I want audit logs
  So that I can monitor access

  Scenario: Untraceable scenario without authority ref
    Given an action
    When performed
    Then logged
`;
    fakeGateway.queueResponse(untraceableGherkin);

    // Attempt 1: Fixed with @requirements tag
    const validGherkin = createValidGherkin('BASE-001', ['REQ-001-R1']);
    fakeGateway.queueResponse(validGherkin);

    const result = await useCase.execute({
      baselineId: baseline.id
    });

    expect(result.metadata.measuredVerification.repairsNeeded).toBe(1);
    expect(result.repairHistory[0].errorMessage).toContain(
      "Scenario 'Untraceable scenario without authority ref' must declare at least one authority reference via @requirements:<revId>"
    );
  });

  it('rejects out-of-baseline requirement revision reference and repairs on next attempt', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'System must log audit events',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-001'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    // Attempt 0: References REQ-999-R1 not in baseline
    const invalidRefGherkin = createValidGherkin('BASE-001', ['REQ-999-R1']);
    fakeGateway.queueResponse(invalidRefGherkin);

    // Attempt 1: Corrected with REQ-001-R1
    const validGherkin = createValidGherkin('BASE-001', ['REQ-001-R1']);
    fakeGateway.queueResponse(validGherkin);

    const result = await useCase.execute({
      baselineId: baseline.id
    });

    expect(result.metadata.measuredVerification.repairsNeeded).toBe(1);
    expect(result.repairHistory[0].errorMessage).toContain(
      "Requirement revision(s) [REQ-999-R1] are not members of baseline 'BASE-001'"
    );
  });

  it('throws RepairRetryExhaustionError when repair attempts are exhausted', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Rule statement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-001'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    // Always return invalid Gherkin
    fakeGateway.setDefaultResponse('Not a gherkin document');

    await expect(
      useCase.execute({
        baselineId: baseline.id,
        options: { maxRepairAttempts: 2 }
      })
    ).rejects.toThrow(RepairRetryExhaustionError);
  });

  it('extracts candidate findings and proposed engineering decisions from Gherkin comments', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'User session duration',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-001'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    const gherkinWithDiscoveries = createValidGherkin('BASE-001', ['REQ-001-R1'], {
      extraComments: [
        '# @finding: undefined-cardinality | Session timeout duration is undefined in requirements',
        '# @decision: 15-minute sliding session window | Security standard default'
      ]
    });
    fakeGateway.queueResponse(gherkinWithDiscoveries);

    const result = await useCase.execute({
      baselineId: baseline.id,
      autoRecordDiscoveries: true
    });

    // Check findings
    expect(result.candidateFindings).toHaveLength(1);
    const finding = result.candidateFindings![0];
    expect(finding.type).toBe('undefined-cardinality');
    expect(finding.disposition).toBe('OPEN');
    expect(finding.discoveredBy).toBe('artifact-validation');
    expect(finding.rationale).toBe('Session timeout duration is undefined in requirements');
    expect(finding.affectedRequirementRevisions).toEqual(['REQ-001-R1']);

    // Check finding persisted in repo
    const savedFinding = await repo.getCandidateFinding(finding.id);
    expect(savedFinding).toBeDefined();
    expect(savedFinding?.id).toBe(finding.id);

    // Check decisions
    expect(result.proposedEngineeringDecisions).toHaveLength(1);
    const decision = result.proposedEngineeringDecisions![0];
    expect(decision.statement).toBe('15-minute sliding session window');
    expect(decision.rationale).toBe('Security standard default');
    expect(decision.state).toBe('PROPOSED');

    // Check decision persisted in repo
    const savedDecision = await repo.getEngineeringDecision(decision.id);
    expect(savedDecision).toBeDefined();
    expect(savedDecision?.id).toBe(decision.id);
  });

  it('rejects empty baseline with EmptyBaselineError', async () => {
    // Save empty baseline
    const emptyBaseline = {
      id: createRequirementsBaselineId('BASE-EMPTY'),
      requirementRevisions: [],
      policyConstraintRevisions: [],
      createdAt: createInstant('2026-09-18T12:00:00.000Z'),
      createdBy: createReviewerId('REV-LEAD')
    };
    await repo.saveRequirementsBaseline(emptyBaseline as any);

    await expect(
      useCase.execute({
        baselineId: 'BASE-EMPTY'
      })
    ).rejects.toThrow(EmptyBaselineError);
  });

  it('rejects unknown baseline with UnknownRequirementsBaselineError', async () => {
    await expect(
      useCase.execute({
        baselineId: 'BASE-NONEXISTENT'
      })
    ).rejects.toThrow(UnknownRequirementsBaselineError);
  });
});
