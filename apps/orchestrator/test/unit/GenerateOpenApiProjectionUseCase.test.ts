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
  createEngineeringDecisionId,
  createReviewerId,
  createInstant,
  createRequirementsBaseline,
  createRequirementRevision,
  createPolicyConstraintRevision,
  createEngineeringDecision,
  EmptyBaselineError
} from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeGenerationGateway } from '../fakes/FakeGenerationGateway.js';
import { FakeOpenApiValidatorGateway } from '../fakes/FakeOpenApiValidatorGateway.js';
import { GenerateOpenApiProjectionUseCase } from '../../src/application/use-cases/GenerateOpenApiProjectionUseCase.js';
import {
  UnknownRequirementsBaselineError,
  UnknownEngineeringDecisionError
} from '../../src/application/use-cases/ReconciliationErrors.js';
import {
  UnacceptedEngineeringDecisionError,
  RepairRetryExhaustionError,
  OpenApiProvenanceValidationError
} from '../../src/application/use-cases/OpenApiProjectionErrors.js';
import type { ProjectionRecord } from '../../src/application/ports/persistence/IRequirementsRepository.js';

describe('GenerateOpenApiProjectionUseCase', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let fakeGateway: FakeGenerationGateway;
  let fakeValidator: FakeOpenApiValidatorGateway;
  let useCase: GenerateOpenApiProjectionUseCase;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openapi-proj-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    fakeGateway = new FakeGenerationGateway();
    fakeValidator = new FakeOpenApiValidatorGateway();
    useCase = new GenerateOpenApiProjectionUseCase(fakeGateway, fakeValidator, repo, 'fake');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function createValidOpenApi(
    baselineId: string,
    reqIds: string[],
    options?: {
      polIds?: string[];
      edIds?: string[];
      paths?: string;
      schemas?: string;
      decisions?: string[];
      findings?: string[];
    }
  ): string {
    const lines = [`# @baseline ${baselineId}`, `# @requirements ${reqIds.join(', ')}`];
    if (options?.polIds && options.polIds.length > 0) {
      lines.push(`# @policy-constraints ${options.polIds.join(', ')}`);
    }
    if (options?.edIds && options.edIds.length > 0) {
      lines.push(`# @engineering-decisions ${options.edIds.join(', ')}`);
    }
    if (options?.decisions) {
      for (const d of options.decisions) {
        lines.push(`# @decision: ${d}`);
      }
    }
    if (options?.findings) {
      for (const f of options.findings) {
        lines.push(`# @finding: ${f}`);
      }
    }

    lines.push(
      'openapi: 3.1.0',
      'info:',
      '  title: Test Service API',
      '  version: 1.0.0',
      'paths:',
      options?.paths ??
        `  /users:
    get:
      operationId: listUsers
      responses:
        '200':
          description: OK`,
      'components:',
      '  schemas:',
      options?.schemas ??
        `    User:
      type: object
      required:
        - id
      properties:
        id:
          type: string`
    );

    return lines.join('\n');
  }

  it('generates a valid OpenAPI 3.1 projection on first attempt with exact provenance', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'User accounts must be searchable by email',
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
      createdAt: createInstant('2026-09-18T12:00:00.000Z')
    });
    await repo.saveRequirementsBaseline(baseline);

    const validContent = createValidOpenApi('BASE-001', ['REQ-001-R1']);
    fakeGateway.queueResponse(`\`\`\`yaml\n${validContent}\n\`\`\``);

    const result = await useCase.execute({
      baselineId: baseline.id
    });

    expect(result.content).toBe(validContent);
    expect(result.metadata.baselineId).toBe('BASE-001');
    expect(result.metadata.artifactType).toBe('openapi');
    expect(result.metadata.requirementRevisionIds).toEqual(['REQ-001-R1']);
    expect(result.metadata.declaredProvenance.baselineId).toBe('BASE-001');
    expect(result.metadata.declaredProvenance.requirementRevisionIds).toEqual(['REQ-001-R1']);
    expect(result.metadata.measuredVerification.repairsNeeded).toBe(0);
    expect(result.metadata.measuredVerification.attemptCount).toBe(1);
    expect(result.metadata.measuredVerification.contentHash).toBeDefined();

    // Verify persistence in repository
    const saved = await repo.getProjectionRecord(result.projectionId);
    expect(saved).toBeDefined();
    expect(saved?.baselineId).toBe('BASE-001');
    expect(saved?.artifactType).toBe('openapi');
    expect(saved?.content).toBe(validContent);
  });

  it('performs closed-loop repair when OpenAPI validator reports a structural error', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Get order details',
      category: 'business-rule',
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

    const invalidContent = createValidOpenApi('BASE-002', ['REQ-001-R1'], {
      paths: `  /orders/{id}:\n    get:\n      responses: {}`
    });
    const repairedContent = createValidOpenApi('BASE-002', ['REQ-001-R1'], {
      paths: `  /orders:\n    get:\n      operationId: getOrders\n      responses:\n        '200':\n          description: OK`
    });

    fakeGateway.queueResponse(invalidContent);
    fakeGateway.queueResponse(repairedContent);

    fakeValidator.failNextNTimes(
      1,
      "Operation 'GET /orders/{id}' must declare a 'responses' object"
    );

    const result = await useCase.execute({
      baselineId: baseline.id
    });

    expect(result.content).toBe(repairedContent);
    expect(result.metadata.measuredVerification.repairsNeeded).toBe(1);
    expect(result.metadata.measuredVerification.attemptCount).toBe(2);
    expect(result.repairHistory).toHaveLength(1);
    expect(result.repairHistory[0].errorMessage).toContain('must declare a');
  });

  it('performs closed-loop repair when declared provenance contains invalid revision IDs', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Store orders',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-003'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    const invalidProv = createValidOpenApi('BASE-003', ['REQ-001-R1', 'REQ-NONEXISTENT']);
    const repairedProv = createValidOpenApi('BASE-003', ['REQ-001-R1']);

    fakeGateway.queueResponse(invalidProv);
    fakeGateway.queueResponse(repairedProv);

    const result = await useCase.execute({
      baselineId: baseline.id
    });

    expect(result.content).toBe(repairedProv);
    expect(result.metadata.measuredVerification.repairsNeeded).toBe(1);
    expect(result.metadata.declaredProvenance.requirementRevisionIds).toEqual(['REQ-001-R1']);
  });

  it('exhausts repair attempts and throws RepairRetryExhaustionError', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Test requirement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-004'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    const invalidContent = createValidOpenApi('BASE-004', ['REQ-001-R1']);
    fakeGateway.queueResponse(invalidContent);
    fakeGateway.queueResponse(invalidContent);
    fakeGateway.queueResponse(invalidContent);

    fakeValidator.failNextNTimes(5, 'Continuous structural failure');

    await expect(
      useCase.execute({
        baselineId: baseline.id
      })
    ).rejects.toThrow(RepairRetryExhaustionError);
  });

  it('enforces conditional invariants on policy constraints header', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Sensitive data management',
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
      statement: 'All endpoints must enforce TLS 1.3',
      authorityReference: 'NIST-800-53',
      createdAt: createInstant('2026-09-18T12:00:00.000Z'),
      createdBy: createReviewerId('REV-SEC')
    });
    await repo.savePolicyConstraintRevision(pol1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-005'),
      requirements: [rev1],
      policyConstraints: [pol1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    // Initial response omits policy constraints -> repair should fix it
    const missingPol = createValidOpenApi('BASE-005', ['REQ-001-R1']);
    const repairedPol = createValidOpenApi('BASE-005', ['REQ-001-R1'], {
      polIds: ['POL-SEC-001-R1']
    });

    fakeGateway.queueResponse(missingPol);
    fakeGateway.queueResponse(repairedPol);

    const result = await useCase.execute({
      baselineId: baseline.id
    });

    expect(result.content).toBe(repairedPol);
    expect(result.metadata.declaredProvenance.policyConstraintRevisionIds).toEqual([
      'POL-SEC-001-R1'
    ]);
  });

  it('fails closed when caller explicitly specifies an unaccepted engineering decision', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Order tracking',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-006'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    const proposedEd = createEngineeringDecision({
      id: createEngineeringDecisionId('ED-PROP-001'),
      baselineId: baseline.id,
      statement: 'Use cursor pagination',
      rationale: 'Scalability for large sets',
      requirementRevisionIds: [rev1.id],
      policyConstraintRevisionIds: [],
      state: 'PROPOSED',
      createdBy: 'openapi-generator'
    });
    await repo.saveEngineeringDecision(proposedEd);

    await expect(
      useCase.execute({
        baselineId: baseline.id,
        engineeringDecisionIds: [proposedEd.id]
      })
    ).rejects.toThrow(UnacceptedEngineeringDecisionError);
  });

  it('extracts proposed engineering decisions and candidate findings from contract', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Pagination support',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-007'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    const contentWithDiscoveries = createValidOpenApi('BASE-007', ['REQ-001-R1'], {
      decisions: [
        'Use opaque cursor for list endpoints | Improves query latency on large datasets'
      ],
      findings: ['undefined-cardinality | Maximum page limit is unstated in requirements']
    });

    fakeGateway.queueResponse(contentWithDiscoveries);

    const result = await useCase.execute({
      baselineId: baseline.id
    });

    expect(result.proposedEngineeringDecisions).toHaveLength(1);
    expect(result.proposedEngineeringDecisions![0].statement).toBe(
      'Use opaque cursor for list endpoints'
    );
    expect(result.proposedEngineeringDecisions![0].state).toBe('PROPOSED');

    expect(result.candidateFindings).toBeDefined();
    const finding = result.candidateFindings!.find((f) => f.type === 'undefined-cardinality');
    expect(finding).toBeDefined();
    expect(finding?.disposition).toBe('OPEN');
    expect(finding?.discoveredBy).toBe('artifact-validation');
    expect(finding?.affectedRequirementRevisions).toEqual([rev1.id]);
  });

  it('detects schema/API contradictions during targeted cross-validation against SQL schema', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Users and accounts',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-008'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    // Save a SQL schema projection with accounts table having UUID id
    const sqlProjection: ProjectionRecord = {
      id: 'PROJ-SQL-001',
      baselineId: baseline.id,
      requirementRevisionIds: baseline.requirementRevisions,
      artifactType: 'sql-schema',
      content: `CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL,
        phone_number TEXT NOT NULL
      );`,
      metadata: {
        baselineId: baseline.id,
        requirementRevisionIds: [...baseline.requirementRevisions],
        artifactType: 'sql-schema',
        declaredProvenance: {
          baselineId: baseline.id,
          requirementRevisionIds: [...baseline.requirementRevisions]
        },
        configuredExecution: { provider: 'fake', artifactType: 'sql-schema' },
        measuredVerification: {
          repairsNeeded: 0,
          attemptCount: 1,
          contentHash: 'abc',
          verifiedAt: createInstant('2026-09-18T12:00:00.000Z')
        }
      },
      createdAt: createInstant('2026-09-18T12:00:00.000Z')
    };
    await repo.saveProjectionRecord(sqlProjection);

    // OpenAPI contract defines users id as integer (contradiction),
    // and requires taxId which does not exist in table (data-boundary-ambiguity),
    // and declares Orders entity which has no SQL table (data-boundary-ambiguity).
    const openApiContent = createValidOpenApi('BASE-008', ['REQ-001-R1'], {
      paths: `  /users:
    get:
      operationId: listUsers
      responses:
        '200':
          description: OK
  /orders:
    get:
      operationId: listOrders
      responses:
        '200':
          description: OK`,
      schemas: `    User:
      type: object
      required:
        - id
        - taxId
      properties:
        id:
          type: integer
        taxId:
          type: string
    Order:
      type: object
      required:
        - orderId
      properties:
        orderId:
          type: string`
    });

    fakeGateway.queueResponse(openApiContent);

    const result = await useCase.execute({
      baselineId: baseline.id
    });

    expect(result.candidateFindings).toBeDefined();
    expect(result.candidateFindings!.length).toBeGreaterThan(0);

    // 1. Contradiction finding on id type
    const idContradiction = result.candidateFindings!.find(
      (f) => f.type === 'contradiction' && f.rationale?.includes("defines 'id' as type 'integer'")
    );
    expect(idContradiction).toBeDefined();
    expect(idContradiction?.discoveredBy).toBe('artifact-validation');

    // 2. Data boundary ambiguity finding on unrepresentable taxId
    const taxIdAmbiguity = result.candidateFindings!.find(
      (f) => f.type === 'data-boundary-ambiguity' && f.rationale?.includes('taxId')
    );
    expect(taxIdAmbiguity).toBeDefined();

    // 3. Data boundary ambiguity finding on Order entity missing SQL table
    const orderMissing = result.candidateFindings!.find(
      (f) => f.type === 'data-boundary-ambiguity' && f.rationale?.includes('Order')
    );
    expect(orderMissing).toBeDefined();
  });

  it('fails closed on unknown baseline', async () => {
    await expect(
      useCase.execute({
        baselineId: 'NON-EXISTENT'
      })
    ).rejects.toThrow(UnknownRequirementsBaselineError);
  });

  it('fails closed with EmptyBaselineError when baseline has no requirement revisions', async () => {
    const emptyBaseline = {
      id: createRequirementsBaselineId('BASE-EMPTY'),
      requirementRevisions: [],
      policyConstraintRevisions: [],
      createdBy: createReviewerId('REV-LEAD'),
      createdAt: createInstant('2026-09-18T12:00:00.000Z')
    };
    await repo.saveRequirementsBaseline(emptyBaseline);

    await expect(
      useCase.execute({
        baselineId: emptyBaseline.id
      })
    ).rejects.toThrow(EmptyBaselineError);
  });

  it('fails closed with UnknownEngineeringDecisionError when explicit decision does not exist', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Test requirement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-ED-01'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    await expect(
      useCase.execute({
        baselineId: baseline.id,
        engineeringDecisionIds: ['ED-NONEXISTENT']
      })
    ).rejects.toThrow(UnknownEngineeringDecisionError);
  });

  it('fails closed with OpenApiProvenanceValidationError when decision belongs to another baseline', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Test requirement',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-ED-02'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    const otherDecision = createEngineeringDecision({
      id: createEngineeringDecisionId('ED-OTHER'),
      baselineId: createRequirementsBaselineId('BASE-OTHER'),
      statement: 'Other baseline decision',
      rationale: 'Other baseline rationale',
      requirementRevisionIds: [rev1.id],
      policyConstraintRevisionIds: [],
      state: 'ACCEPTED',
      acceptedBy: createReviewerId('REV-LEAD'),
      acceptedAt: createInstant('2026-09-18T12:00:00.000Z'),
      createdBy: 'openapi-generator'
    });
    await repo.saveEngineeringDecision(otherDecision);

    await expect(
      useCase.execute({
        baselineId: baseline.id,
        engineeringDecisionIds: [otherDecision.id]
      })
    ).rejects.toThrow(OpenApiProvenanceValidationError);
  });
});
