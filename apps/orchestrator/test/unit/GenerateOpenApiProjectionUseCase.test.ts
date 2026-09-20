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
import {
  UnknownProjectionError,
  ProjectionBaselineMismatchError,
  ProjectionArtifactTypeMismatchError,
  ConflictingSqlProjectionAuthorityError
} from '../../src/application/use-cases/DiscoveryErrors.js';
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

  it('injects SQL schema tables, primary key types, and decisions into OpenAPI prompt when sqlSchemaProjectionId is provided', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Manage orders',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-SQL-CTX-1'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    const sqlProjection: ProjectionRecord = {
      id: 'PROJ-SQL-ORDERS-1',
      baselineId: baseline.id,
      requirementRevisionIds: baseline.requirementRevisions,
      artifactType: 'sql-schema',
      content: [
        '-- @baseline BASE-SQL-CTX-1',
        '-- @requirements REQ-001-R1',
        '-- @decision: Use BIGINT GENERATED ALWAYS AS IDENTITY for primary keys | Sequential surrogate key',
        '',
        'CREATE TABLE orders (',
        '  order_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,',
        '  status VARCHAR(32) NOT NULL',
        ');'
      ].join('\n'),
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
          contentHash: 'hash',
          verifiedAt: createInstant('2026-09-18T12:00:00.000Z')
        }
      },
      createdAt: createInstant('2026-09-18T12:00:00.000Z')
    };
    await repo.saveProjectionRecord(sqlProjection);

    const openApiContent = createValidOpenApi('BASE-SQL-CTX-1', ['REQ-001-R1'], {
      paths: `  /orders:\n    get:\n      operationId: listOrders\n      responses:\n        '200':\n          description: OK`,
      schemas: `    Order:\n      type: object\n      required:\n        - order_id\n      properties:\n        order_id:\n          type: integer`
    });
    fakeGateway.queueResponse(openApiContent);

    await useCase.execute({
      baselineId: baseline.id,
      sqlSchemaProjectionId: sqlProjection.id
    });

    const sentPrompt = fakeGateway.recordedRequests[0].prompt;
    expect(sentPrompt).toContain(
      'Relational Schema Context (from SQL projection PROJ-SQL-ORDERS-1):'
    );
    expect(sentPrompt).toContain("Table 'orders': Primary key column 'order_id' (Type: BIGINT)");
    expect(sentPrompt).toContain('Relational Engineering Decisions:');
    expect(sentPrompt).toContain(
      'Use BIGINT GENERATED ALWAYS AS IDENTITY for primary keys | Sequential surrogate key'
    );
    expect(sentPrompt).toContain('OpenAPI Identifier Alignment Requirements:');
    expect(sentPrompt).toContain(
      "If SQL primary key is integer/BIGINT/SERIAL: OpenAPI schema property must be type 'integer'."
    );
  });

  it('injects latest SQL schema projection from repository into prompt when sqlSchemaProjectionId is omitted', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Manage users',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-SQL-AUTO-1'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    // Older projection with alphabetically higher ID ('PROJ-SQL-ZZZ-OLDER')
    const olderSqlProjection: ProjectionRecord = {
      id: 'PROJ-SQL-ZZZ-OLDER',
      baselineId: baseline.id,
      requirementRevisionIds: baseline.requirementRevisions,
      artifactType: 'sql-schema',
      content: [
        '-- @baseline BASE-SQL-AUTO-1',
        '-- @requirements REQ-001-R1',
        '',
        'CREATE TABLE legacy_users (',
        '  id UUID PRIMARY KEY DEFAULT gen_random_uuid()',
        ');'
      ].join('\n'),
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
          contentHash: 'hash',
          verifiedAt: createInstant('2026-09-18T10:00:00.000Z')
        }
      },
      createdAt: createInstant('2026-09-18T10:00:00.000Z')
    };
    await repo.saveProjectionRecord(olderSqlProjection);

    // Newer projection with alphabetically lower ID ('PROJ-SQL-AAA-NEWER')
    const newerSqlProjection: ProjectionRecord = {
      id: 'PROJ-SQL-AAA-NEWER',
      baselineId: baseline.id,
      requirementRevisionIds: baseline.requirementRevisions,
      artifactType: 'sql-schema',
      content: [
        '-- @baseline BASE-SQL-AUTO-1',
        '-- @requirements REQ-001-R1',
        '',
        'CREATE TABLE users (',
        '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
        '  email TEXT NOT NULL',
        ');'
      ].join('\n'),
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
          contentHash: 'hash',
          verifiedAt: createInstant('2026-09-18T12:00:00.000Z')
        }
      },
      createdAt: createInstant('2026-09-18T12:00:00.000Z')
    };
    await repo.saveProjectionRecord(newerSqlProjection);

    const openApiContent = createValidOpenApi('BASE-SQL-AUTO-1', ['REQ-001-R1']);
    fakeGateway.queueResponse(openApiContent);

    await useCase.execute({
      baselineId: baseline.id
    });

    const sentPrompt = fakeGateway.recordedRequests[0].prompt;
    // Must select the newer one ('PROJ-SQL-AAA-NEWER') rather than alphabetical last ('PROJ-SQL-ZZZ-OLDER')
    expect(sentPrompt).toContain(
      'Relational Schema Context (from SQL projection PROJ-SQL-AAA-NEWER):'
    );
    expect(sentPrompt).toContain("Table 'users': Primary key column 'id' (Type: UUID)");
    expect(sentPrompt).not.toContain('PROJ-SQL-ZZZ-OLDER');
    expect(sentPrompt).not.toContain('legacy_users');
    expect(sentPrompt).toContain(
      "If SQL primary key is UUID: OpenAPI schema property must be type 'string' with format 'uuid'."
    );
  });

  it('instructs integer ID type when SQL schema uses BIGINT identity primary keys', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Manage products',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-SQL-INT-1'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    const sqlProjection: ProjectionRecord = {
      id: 'PROJ-SQL-PRODUCTS',
      baselineId: baseline.id,
      requirementRevisionIds: baseline.requirementRevisions,
      artifactType: 'sql-schema',
      content: [
        '-- @baseline BASE-SQL-INT-1',
        '-- @requirements REQ-001-R1',
        '',
        'CREATE TABLE products (',
        '  product_id BIGINT PRIMARY KEY,',
        '  name TEXT NOT NULL',
        ');'
      ].join('\n'),
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
          contentHash: 'hash',
          verifiedAt: createInstant('2026-09-18T12:00:00.000Z')
        }
      },
      createdAt: createInstant('2026-09-18T12:00:00.000Z')
    };
    await repo.saveProjectionRecord(sqlProjection);

    const openApiContent = createValidOpenApi('BASE-SQL-INT-1', ['REQ-001-R1'], {
      paths: `  /products:\n    get:\n      operationId: listProducts\n      responses:\n        '200':\n          description: OK`,
      schemas: `    Product:\n      type: object\n      required:\n        - product_id\n      properties:\n        product_id:\n          type: integer`
    });
    fakeGateway.queueResponse(openApiContent);

    await useCase.execute({
      baselineId: baseline.id,
      sqlSchemaProjectionId: sqlProjection.id
    });

    const sentPrompt = fakeGateway.recordedRequests[0].prompt;
    expect(sentPrompt).toContain(
      "If SQL primary key is integer/BIGINT/SERIAL: OpenAPI schema property must be type 'integer'."
    );
  });

  it('includes default UUID format in prompt when no SQL projection or decision exists', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Manage items',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-NO-SQL-1'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    const openApiContent = createValidOpenApi('BASE-NO-SQL-1', ['REQ-001-R1']);
    fakeGateway.queueResponse(openApiContent);

    await useCase.execute({
      baselineId: baseline.id
    });

    const sentPrompt = fakeGateway.recordedRequests[0].prompt;
    expect(sentPrompt).toContain('Primary Key & Identifier Format Convention:');
    expect(sentPrompt).toContain(
      "In the absence of an accepted engineering decision or relational schema context specifying an alternative, use UUID format ('id: { type: string, format: uuid }') as the standard primary key format."
    );
  });

  it('includes strict compliance directive when accepted engineering decisions are provided', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Manage accounts',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-ED-OPENAPI-1'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    const decision = createEngineeringDecision({
      id: createEngineeringDecisionId('ED-OAS-001'),
      baselineId: baseline.id,
      statement: 'Use UUID primary keys with gen_random_uuid()',
      rationale: 'Avoid integer sequential key enumeration',
      requirementRevisionIds: [rev1.id],
      policyConstraintRevisionIds: [],
      state: 'ACCEPTED',
      acceptedBy: createReviewerId('REV-LEAD'),
      acceptedAt: createInstant('2026-09-18T12:00:00.000Z'),
      createdBy: 'openapi-generator'
    });
    await repo.saveEngineeringDecision(decision);

    const openApiContent = createValidOpenApi('BASE-ED-OPENAPI-1', ['REQ-001-R1'], {
      edIds: ['ED-OAS-001']
    });
    fakeGateway.queueResponse(openApiContent);

    await useCase.execute({
      baselineId: baseline.id,
      engineeringDecisionIds: ['ED-OAS-001']
    });

    const sentPrompt = fakeGateway.recordedRequests[0].prompt;
    expect(sentPrompt).toContain(
      'MUST strictly comply with and implement all Accepted Engineering Decisions above (including primary key types and surrogate key strategies).'
    );
  });

  it('throws UnknownProjectionError when explicit sqlSchemaProjectionId does not exist', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Manage users',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-SQL-MISSING-1'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    await expect(
      useCase.execute({
        baselineId: baseline.id,
        sqlSchemaProjectionId: 'PROJ-NONEXISTENT'
      })
    ).rejects.toThrow(UnknownProjectionError);
  });

  it('throws ProjectionBaselineMismatchError when explicit sqlSchemaProjectionId belongs to another baseline', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Manage users',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline1 = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-1'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    const baseline2 = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-2'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline1);
    await repo.saveRequirementsBaseline(baseline2);

    const foreignSqlProjection: ProjectionRecord = {
      id: 'PROJ-SQL-FOREIGN',
      baselineId: baseline2.id,
      requirementRevisionIds: baseline2.requirementRevisions,
      artifactType: 'sql-schema',
      content: '-- @baseline BASE-2\nCREATE TABLE orders (id UUID PRIMARY KEY);',
      metadata: {
        baselineId: baseline2.id,
        requirementRevisionIds: [...baseline2.requirementRevisions],
        artifactType: 'sql-schema',
        declaredProvenance: {
          baselineId: baseline2.id,
          requirementRevisionIds: [...baseline2.requirementRevisions]
        },
        configuredExecution: { provider: 'fake', artifactType: 'sql-schema' },
        measuredVerification: {
          repairsNeeded: 0,
          attemptCount: 1,
          contentHash: 'h',
          verifiedAt: createInstant('2026-09-18T12:00:00.000Z')
        }
      },
      createdAt: createInstant('2026-09-18T12:00:00.000Z')
    };
    await repo.saveProjectionRecord(foreignSqlProjection);

    await expect(
      useCase.execute({
        baselineId: baseline1.id,
        sqlSchemaProjectionId: foreignSqlProjection.id
      })
    ).rejects.toThrow(ProjectionBaselineMismatchError);
  });

  it('throws ProjectionArtifactTypeMismatchError when explicit projection is not sql-schema', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Manage users',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-NON-SQL-1'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    const diagramProjection: ProjectionRecord = {
      id: 'PROJ-DIAGRAM-1',
      baselineId: baseline.id,
      requirementRevisionIds: baseline.requirementRevisions,
      artifactType: 'process-diagram',
      content: 'stateDiagram-v2\n[*] --> Active',
      metadata: {
        baselineId: baseline.id,
        requirementRevisionIds: [...baseline.requirementRevisions],
        artifactType: 'process-diagram',
        declaredProvenance: {
          baselineId: baseline.id,
          requirementRevisionIds: [...baseline.requirementRevisions]
        },
        configuredExecution: { provider: 'fake', artifactType: 'process-diagram' },
        measuredVerification: {
          repairsNeeded: 0,
          attemptCount: 1,
          contentHash: 'h',
          verifiedAt: createInstant('2026-09-18T12:00:00.000Z')
        }
      },
      createdAt: createInstant('2026-09-18T12:00:00.000Z')
    };
    await repo.saveProjectionRecord(diagramProjection);

    await expect(
      useCase.execute({
        baselineId: baseline.id,
        sqlSchemaProjectionId: diagramProjection.id
      })
    ).rejects.toThrow(ProjectionArtifactTypeMismatchError);
  });

  it('throws ConflictingSqlProjectionAuthorityError when same-baseline SQL projection conflicts with accepted EngineeringDecision primary key type', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Manage orders',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-CONFLICT-1'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    // SQL projection defines BIGINT primary key
    const sqlProjection: ProjectionRecord = {
      id: 'PROJ-SQL-BIGINT',
      baselineId: baseline.id,
      requirementRevisionIds: baseline.requirementRevisions,
      artifactType: 'sql-schema',
      content: [
        '-- @baseline BASE-CONFLICT-1',
        '-- @requirements REQ-001-R1',
        'CREATE TABLE orders (',
        '  order_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,',
        '  title TEXT NOT NULL',
        ');'
      ].join('\n'),
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
          contentHash: 'h',
          verifiedAt: createInstant('2026-09-18T11:00:00.000Z')
        }
      },
      createdAt: createInstant('2026-09-18T11:00:00.000Z')
    };
    await repo.saveProjectionRecord(sqlProjection);

    // Accepted decision explicitly mandates UUID primary keys
    const uuidDecision = createEngineeringDecision({
      id: createEngineeringDecisionId('ED-CONFLICT-UUID'),
      baselineId: baseline.id,
      statement: 'Use UUID primary keys with gen_random_uuid() for entity tables',
      rationale: 'Mandatory standard UUID identifier strategy',
      requirementRevisionIds: [rev1.id],
      policyConstraintRevisionIds: [],
      state: 'ACCEPTED',
      acceptedBy: createReviewerId('REV-LEAD'),
      acceptedAt: createInstant('2026-09-18T12:00:00.000Z'),
      createdBy: 'ARCH'
    });
    await repo.saveEngineeringDecision(uuidDecision);

    await expect(
      useCase.execute({
        baselineId: baseline.id,
        sqlSchemaProjectionId: sqlProjection.id,
        engineeringDecisionIds: [uuidDecision.id]
      })
    ).rejects.toThrow(ConflictingSqlProjectionAuthorityError);
  });

  it('includes relational schema context and alignment requirements in repair prompt on retry', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-001-R1'),
      requirementId: createRequirementId('REQ-001'),
      revision: 1,
      statement: 'Manage users',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-REPAIR-SQL-1'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    const sqlProjection: ProjectionRecord = {
      id: 'PROJ-SQL-REPAIR-1',
      baselineId: baseline.id,
      requirementRevisionIds: baseline.requirementRevisions,
      artifactType: 'sql-schema',
      content: [
        '-- @baseline BASE-REPAIR-SQL-1',
        '-- @requirements REQ-001-R1',
        'CREATE TABLE users (',
        '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
        '  name TEXT NOT NULL',
        ');'
      ].join('\n'),
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
          contentHash: 'h',
          verifiedAt: createInstant('2026-09-18T12:00:00.000Z')
        }
      },
      createdAt: createInstant('2026-09-18T12:00:00.000Z')
    };
    await repo.saveProjectionRecord(sqlProjection);

    // Force first candidate to fail validation to trigger repair loop
    fakeValidator.failNextNTimes(1, 'OpenAPI validation failed: schema error');

    // First attempt candidate
    const initialCandidate = createValidOpenApi('BASE-REPAIR-SQL-1', ['REQ-001-R1']);
    fakeGateway.queueResponse(initialCandidate);

    // Second attempt (repair): valid OpenAPI
    const repairedCandidate = createValidOpenApi('BASE-REPAIR-SQL-1', ['REQ-001-R1']);
    fakeGateway.queueResponse(repairedCandidate);

    const result = await useCase.execute({
      baselineId: baseline.id,
      sqlSchemaProjectionId: sqlProjection.id,
      options: { maxRepairAttempts: 2 }
    });

    expect(result.metadata.measuredVerification.repairsNeeded).toBe(1);
    expect(fakeGateway.recordedRequests).toHaveLength(2);

    // Verify repair prompt (the second request) received the SQL primary-key context
    const repairPrompt = fakeGateway.recordedRequests[1].prompt;
    expect(repairPrompt).toContain(
      'OpenAPI Identifier Alignment Requirements (MUST strictly match relational primary keys):'
    );
    expect(repairPrompt).toContain("Table 'users': Primary key column 'id' (Type: UUID)");
    expect(repairPrompt).toContain(
      "If SQL primary key is UUID: OpenAPI schema property must be type 'string' with format 'uuid'."
    );
  });

  it('injects full column definitions, constraints, and child relationships into OpenAPI prompt (Phase 3.11)', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-311-01-R1'),
      requirementId: createRequirementId('REQ-311-01'),
      revision: 1,
      statement: 'Orders and line items',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-311-01'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    const sqlProjection: ProjectionRecord = {
      id: 'PROJ-SQL-311-01',
      baselineId: baseline.id,
      requirementRevisionIds: baseline.requirementRevisions,
      artifactType: 'sql-schema',
      content: [
        '-- @baseline BASE-311-01',
        '-- @requirements REQ-311-01-R1',
        '',
        'CREATE TABLE orders (',
        '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
        '  customer_id VARCHAR(64) NOT NULL',
        ');',
        '',
        'CREATE TABLE order_line_items (',
        '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
        '  order_id UUID NOT NULL REFERENCES orders(id),',
        '  product_ref VARCHAR(64) NOT NULL,',
        '  qty INTEGER NOT NULL,',
        '  unit_price NUMERIC(10,2) NOT NULL',
        ');'
      ].join('\n'),
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
          contentHash: 'hash',
          verifiedAt: createInstant('2026-09-18T10:00:00.000Z')
        }
      },
      createdAt: createInstant('2026-09-18T10:00:00.000Z')
    };
    await repo.saveProjectionRecord(sqlProjection);

    const openApiContent = createValidOpenApi('BASE-311-01', ['REQ-311-01-R1']);
    fakeGateway.queueResponse(openApiContent);

    await useCase.execute({
      baselineId: baseline.id,
      sqlSchemaProjectionId: sqlProjection.id
    });

    const sentPrompt = fakeGateway.recordedRequests[0].prompt;

    // Relational Schema Context header
    expect(sentPrompt).toContain(
      'Relational Schema Context (from SQL projection PROJ-SQL-311-01):'
    );
    expect(sentPrompt).toContain("Table 'orders': Primary key column 'id' (Type: UUID)");
    expect(sentPrompt).toContain("Table 'order_line_items': Primary key column 'id' (Type: UUID)");

    // Child entity relationship annotation
    expect(sentPrompt).toContain(
      "- Role: Child/related entity of parent table 'orders' (linked via 'order_id' -> 'orders.id')"
    );

    // Full column list with types and constraints
    expect(sentPrompt).toContain("- 'customer_id': VARCHAR(64) [NOT NULL]");
    expect(sentPrompt).toContain("- 'product_ref': VARCHAR(64) [NOT NULL]");
    expect(sentPrompt).toContain("- 'qty': INTEGER [NOT NULL]");
    expect(sentPrompt).toContain("- 'unit_price': NUMERIC(10,2) [NOT NULL]");

    // Explicit naming alignment instructions
    expect(sentPrompt).toContain(
      'OpenAPI Entity, Schema, and Field Naming Alignment Requirements:'
    );
    expect(sentPrompt).toContain(
      'Component schemas representing database entities MUST match the SQL table name'
    );
    expect(sentPrompt).toContain(
      'OpenAPI schema properties MUST use exact matching field names for corresponding SQL columns.'
    );
    expect(sentPrompt).toContain('Ground domain concepts directly in the SQL column names chosen');
    expect(sentPrompt).toContain(
      'MUST strictly align component schema and property names with the relational tables and columns provided in the Relational Schema Context above.'
    );
  });

  it('annotates non-child related tables with Related to table role (Phase 3.11)', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-311-02-R1'),
      requirementId: createRequirementId('REQ-311-02'),
      revision: 1,
      statement: 'Orders and customer accounts',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-311-02'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    const sqlProjection: ProjectionRecord = {
      id: 'PROJ-SQL-311-02',
      baselineId: baseline.id,
      requirementRevisionIds: baseline.requirementRevisions,
      artifactType: 'sql-schema',
      content: [
        '-- @baseline BASE-311-02',
        '-- @requirements REQ-311-02-R1',
        '',
        'CREATE TABLE customer_accounts (',
        '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
        '  account_number VARCHAR(32) NOT NULL',
        ');',
        '',
        'CREATE TABLE orders (',
        '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
        '  account_id UUID NOT NULL REFERENCES customer_accounts(id)',
        ');'
      ].join('\n'),
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
          contentHash: 'hash',
          verifiedAt: createInstant('2026-09-18T10:00:00.000Z')
        }
      },
      createdAt: createInstant('2026-09-18T10:00:00.000Z')
    };
    await repo.saveProjectionRecord(sqlProjection);

    const openApiContent = createValidOpenApi('BASE-311-02', ['REQ-311-02-R1']);
    fakeGateway.queueResponse(openApiContent);

    await useCase.execute({
      baselineId: baseline.id,
      sqlSchemaProjectionId: sqlProjection.id
    });

    const sentPrompt = fakeGateway.recordedRequests[0].prompt;
    expect(sentPrompt).toContain(
      "- Role: Related to table 'customer_accounts' (linked via 'account_id' -> 'customer_accounts.id')"
    );
  });

  it('includes full column context, child roles, and naming alignment instructions in repair prompt (Phase 3.11)', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-311-03-R1'),
      requirementId: createRequirementId('REQ-311-03'),
      revision: 1,
      statement: 'Orders service repair',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-311-03'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    const sqlProjection: ProjectionRecord = {
      id: 'PROJ-SQL-311-03',
      baselineId: baseline.id,
      requirementRevisionIds: baseline.requirementRevisions,
      artifactType: 'sql-schema',
      content: [
        '-- @baseline BASE-311-03',
        '-- @requirements REQ-311-03-R1',
        '',
        'CREATE TABLE orders (',
        '  id UUID PRIMARY KEY DEFAULT gen_random_uuid()',
        ');',
        '',
        'CREATE TABLE order_line_items (',
        '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
        '  order_id UUID NOT NULL REFERENCES orders(id),',
        '  product_ref VARCHAR(64) NOT NULL,',
        '  qty INTEGER NOT NULL',
        ');'
      ].join('\n'),
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
          contentHash: 'hash',
          verifiedAt: createInstant('2026-09-18T10:00:00.000Z')
        }
      },
      createdAt: createInstant('2026-09-18T10:00:00.000Z')
    };
    await repo.saveProjectionRecord(sqlProjection);

    // Force first candidate to fail validation to trigger repair loop
    fakeValidator.failNextNTimes(1, 'OpenAPI validation failed: schema error');

    // Attempt 1: Initial candidate
    const initialCandidate = createValidOpenApi('BASE-311-03', ['REQ-311-03-R1']);
    fakeGateway.queueResponse(initialCandidate);

    // Attempt 2: Repaired candidate
    const validCandidate = createValidOpenApi('BASE-311-03', ['REQ-311-03-R1']);
    fakeGateway.queueResponse(validCandidate);

    const result = await useCase.execute({
      baselineId: baseline.id,
      sqlSchemaProjectionId: sqlProjection.id,
      options: { maxRepairAttempts: 2 }
    });

    expect(result.metadata.measuredVerification.repairsNeeded).toBe(1);
    expect(fakeGateway.recordedRequests).toHaveLength(2);

    const repairPrompt = fakeGateway.recordedRequests[1].prompt;

    expect(repairPrompt).toContain("Table 'orders': Primary key column 'id' (Type: UUID)");
    expect(repairPrompt).toContain(
      "Table 'order_line_items': Primary key column 'id' (Type: UUID)"
    );
    expect(repairPrompt).toContain(
      "- Role: Child/related entity of parent table 'orders' (linked via 'order_id' -> 'orders.id')"
    );
    expect(repairPrompt).toContain("- 'product_ref': VARCHAR(64) [NOT NULL]");
    expect(repairPrompt).toContain("- 'qty': INTEGER [NOT NULL]");
    expect(repairPrompt).toContain(
      'OpenAPI Entity, Schema, and Field Naming Alignment Requirements:'
    );
    expect(repairPrompt).toContain(
      'Component schemas representing database entities MUST match the SQL table name'
    );
    expect(repairPrompt).toContain('- Sub-Resource and Entity Boundary Constraints:');
    expect(repairPrompt).toContain(
      'Every OpenAPI sub-resource path (e.g. "/<parents>/{id}/<children>") and component schema representing a separate child entity MUST correspond to a backing table defined in the Relational Schema Context.'
    );
  });

  it('injects Sub-Resource and Entity Boundary Constraints into initial and repair prompts (Phase 3.14)', async () => {
    const rev1 = createRequirementRevision({
      id: createRequirementRevisionId('REQ-314-01-R1'),
      requirementId: createRequirementId('REQ-314-01'),
      revision: 1,
      statement: 'Order payment verification',
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR'
    });
    await repo.saveRequirementRevision(rev1);

    const baseline = createRequirementsBaseline({
      id: createRequirementsBaselineId('BASE-314-01'),
      requirements: [rev1],
      createdBy: createReviewerId('REV-LEAD')
    });
    await repo.saveRequirementsBaseline(baseline);

    const sqlProjection: ProjectionRecord = {
      id: 'PROJ-SQL-314-01',
      baselineId: baseline.id,
      requirementRevisionIds: baseline.requirementRevisions,
      artifactType: 'sql-schema',
      content: [
        '-- @baseline BASE-314-01',
        '-- @requirements REQ-314-01-R1',
        '',
        'CREATE TABLE orders (',
        '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
        '  status VARCHAR(32) NOT NULL',
        ');'
      ].join('\n'),
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
          contentHash: 'hash',
          verifiedAt: createInstant('2026-09-18T10:00:00.000Z')
        }
      },
      createdAt: createInstant('2026-09-18T10:00:00.000Z')
    };
    await repo.saveProjectionRecord(sqlProjection);

    // Initial attempt prompt check
    const validCandidate = createValidOpenApi('BASE-314-01', ['REQ-314-01-R1']);
    fakeGateway.queueResponse(validCandidate);

    await useCase.execute({
      baselineId: baseline.id,
      sqlSchemaProjectionId: sqlProjection.id
    });

    expect(fakeGateway.recordedRequests).toHaveLength(1);
    const initialPrompt = fakeGateway.recordedRequests[0].prompt;
    expect(initialPrompt).toContain('- Sub-Resource and Entity Boundary Constraints:');
    expect(initialPrompt).toContain(
      'Every OpenAPI sub-resource path (e.g. "/<parents>/{id}/<children>") and component schema representing a separate child entity MUST correspond to a backing table defined in the Relational Schema Context.'
    );
    expect(initialPrompt).toContain(
      'Do NOT invent child sub-resource paths or component schemas representing separate data entities when no corresponding child table exists in the relational schema.'
    );
  });
});
