import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  createRequirementId,
  createRequirementRevisionId,
  createPolicyConstraintId,
  createPolicyConstraintRevisionId,
  createRequirementsBaselineId,
  createReviewerId,
  createRequirementRevision,
  createPolicyConstraintRevision,
  now
} from '@solutions-studio/domain';
import {
  ProjectionRecordDtoSchema,
  RequirementsBaselineDtoSchema
} from '@solutions-studio/contracts';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeGenerationGateway } from '../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../fakes/FakeMermaidLinterGateway.js';
import { FakePrototypeValidatorGateway } from '../fakes/FakePrototypeValidatorGateway.js';
import { PGliteSqlValidatorAdapter } from '../../src/infrastructure/validation/PGliteSqlValidatorAdapter.js';
import { OpenApiStructuralValidatorAdapter } from '../../src/infrastructure/validation/OpenApiStructuralValidatorAdapter.js';
import { composeOrchestratorHttpServer } from '../../src/http/composition.js';

describe('Integration: OpenAPI Projection & Structural Validation (Phase 3.3)', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let fakeGen: FakeGenerationGateway;
  let fakeLinter: FakeMermaidLinterGateway;
  let fakeProtoValidator: FakePrototypeValidatorGateway;
  let realSqlValidator: PGliteSqlValidatorAdapter;
  let realOpenApiValidator: OpenApiStructuralValidatorAdapter;
  let app: FastifyInstance;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openapi-integration-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    fakeGen = new FakeGenerationGateway();
    fakeLinter = new FakeMermaidLinterGateway();
    fakeProtoValidator = new FakePrototypeValidatorGateway();
    realSqlValidator = new PGliteSqlValidatorAdapter();
    realOpenApiValidator = new OpenApiStructuralValidatorAdapter();

    const composed = composeOrchestratorHttpServer({
      repository: repo,
      generationGateway: fakeGen,
      linterGateway: fakeLinter,
      prototypeValidatorGateway: fakeProtoValidator,
      sqlValidatorGateway: realSqlValidator,
      openApiValidatorGateway: realOpenApiValidator
    });
    app = composed.app;
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function seedAuditedRequirement(reqId: string, revId: string, statement: string) {
    const rev = createRequirementRevision({
      id: createRequirementRevisionId(revId),
      requirementId: createRequirementId(reqId),
      revision: 1,
      statement,
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: []
    });
    await repo.saveRequirementRevision(rev);

    await repo.appendReconciliationRecord({
      id: `rec-${revId}`,
      entityType: 'requirement',
      entityId: createRequirementId(reqId),
      requirementRevisionId: rev.id,
      action: 'ACCEPT',
      previousReviewState: undefined,
      newReviewState: 'ACCEPTED',
      rationale: 'Initial requirement audit accepted',
      recordedAt: now()
    });

    return rev;
  }

  it('generates an OpenAPI 3.1 projection via HTTP, validates with real OpenApiStructuralValidatorAdapter, and persists with exact provenance', async () => {
    // 1. Seed requirements and policy constraint
    const req1 = await seedAuditedRequirement(
      'REQ-USER-001',
      'REQ-USER-001-R1',
      'Users must register with a unique email and password'
    );

    const pol1 = createPolicyConstraintRevision({
      id: createPolicyConstraintRevisionId('POL-SEC-001-R1'),
      policyConstraintId: createPolicyConstraintId('POL-SEC-001'),
      revision: 1,
      statement: 'Sensitive customer data must be encrypted at rest and in transit',
      authorityReference: 'NIST-800-53',
      createdAt: now(),
      createdBy: createReviewerId('REV-SEC')
    });
    await repo.savePolicyConstraintRevision(pol1);

    // 2. Create baseline
    const baselineRes = await app.inject({
      method: 'POST',
      url: '/api/baselines',
      payload: {
        id: 'BASE-OAS-001',
        requirementRevisions: [req1.id],
        policyConstraintRevisions: [pol1.id],
        createdBy: 'REV-LEAD'
      }
    });
    expect(baselineRes.statusCode).toBe(200);
    const baselineDto = RequirementsBaselineDtoSchema.parse(baselineRes.json());
    expect(baselineDto.id).toBe('BASE-OAS-001');

    // 3. Queue valid OpenAPI 3.1 YAML generation response with discoveries
    const validOpenApi = [
      '```yaml',
      '# @baseline BASE-OAS-001',
      '# @requirements REQ-USER-001-R1',
      '# @policy-constraints POL-SEC-001-R1',
      '# @decision: Use opaque cursor pagination | Scalability for list endpoints',
      '# @finding: missing-authorization | Unspecified authorization roles for user deletion',
      'openapi: 3.1.0',
      'info:',
      '  title: User Management API',
      '  version: 1.0.0',
      'paths:',
      '  /users:',
      '    get:',
      '      operationId: listUsers',
      '      responses:',
      "        '200':",
      '          description: A list of users',
      '          content:',
      '            application/json:',
      '              schema:',
      '                type: array',
      '                items:',
      "                  $ref: '#/components/schemas/User'",
      'components:',
      '  schemas:',
      '    User:',
      '      type: object',
      '      required:',
      '        - id',
      '        - email',
      '      properties:',
      '        id:',
      '          type: string',
      '          format: uuid',
      '        email:',
      '          type: string',
      '```'
    ].join('\n');
    fakeGen.queueResponse(validOpenApi);

    // 4. Request OpenAPI projection via POST /api/baselines/:baselineId/projections
    const projRes = await app.inject({
      method: 'POST',
      url: `/api/baselines/${baselineDto.id}/projections`,
      payload: {
        artifactType: 'openapi',
        prompt: 'Generate OpenAPI 3.1 contract for user registration'
      }
    });
    expect(projRes.statusCode).toBe(200);
    const projectionDto = ProjectionRecordDtoSchema.parse(projRes.json());

    expect(projectionDto.artifactType).toBe('openapi');
    expect(projectionDto.baselineId).toBe('BASE-OAS-001');
    expect(projectionDto.metadata.declaredProvenance.baselineId).toBe('BASE-OAS-001');
    expect(projectionDto.metadata.declaredProvenance.requirementRevisionIds).toEqual([
      'REQ-USER-001-R1'
    ]);
    expect(projectionDto.metadata.declaredProvenance.policyConstraintRevisionIds).toEqual([
      'POL-SEC-001-R1'
    ]);
    expect(projectionDto.metadata.measuredVerification.repairsNeeded).toBe(0);
    expect(projectionDto.metadata.measuredVerification.attemptCount).toBe(1);

    // 5. Verify persistence and retrieval via GET
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/baselines/${baselineDto.id}/projections/${projectionDto.id}`
    });
    expect(getRes.statusCode).toBe(200);
    const fetched = ProjectionRecordDtoSchema.parse(getRes.json());
    expect(fetched.id).toBe(projectionDto.id);
    expect(fetched.content).toContain('openapi: 3.1.0');

    // 6. Verify proposed engineering decision was saved
    const decisions = await repo.listEngineeringDecisions({
      baselineId: createRequirementsBaselineId(baselineDto.id)
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0].statement).toBe('Use opaque cursor pagination');
    expect(decisions[0].state).toBe('PROPOSED');

    // 7. Verify candidate finding was saved
    const findings = await repo.listCandidateFindings();
    const missingAuthFinding = findings.find((f) => f.type === 'missing-authorization');
    expect(missingAuthFinding).toBeDefined();
    expect(missingAuthFinding?.disposition).toBe('OPEN');
    expect(missingAuthFinding?.discoveredBy).toBe('artifact-validation');
  });

  it('executes targeted cross-validation against existing SQL schema projection and surfaces contradictions', async () => {
    // 1. Seed requirement
    const req1 = await seedAuditedRequirement(
      'REQ-ACC-001',
      'REQ-ACC-001-R1',
      'Accounts management'
    );

    // 2. Create baseline
    const baselineRes = await app.inject({
      method: 'POST',
      url: '/api/baselines',
      payload: {
        id: 'BASE-CROSS-001',
        requirementRevisions: [req1.id],
        createdBy: 'REV-LEAD'
      }
    });
    const baselineDto = RequirementsBaselineDtoSchema.parse(baselineRes.json());

    // 3. Generate SQL schema projection first
    const validSql = [
      '-- @baseline BASE-CROSS-001',
      '-- @requirements REQ-ACC-001-R1',
      'CREATE TABLE accounts (',
      '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
      '  legal_name TEXT NOT NULL,',
      '  created_at TIMESTAMPTZ NOT NULL DEFAULT now()',
      ');'
    ].join('\n');
    fakeGen.queueResponse(`\`\`\`sql\n${validSql}\n\`\`\``);

    const sqlProjRes = await app.inject({
      method: 'POST',
      url: `/api/baselines/${baselineDto.id}/projections`,
      payload: {
        artifactType: 'sql-schema'
      }
    });
    expect(sqlProjRes.statusCode).toBe(200);

    // 4. Generate OpenAPI projection with deliberate contradiction: id defined as integer
    const openApiWithMismatch = [
      '```yaml',
      '# @baseline BASE-CROSS-001',
      '# @requirements REQ-ACC-001-R1',
      'openapi: 3.1.0',
      'info:',
      '  title: Accounts API',
      '  version: 1.0.0',
      'paths:',
      '  /accounts:',
      '    get:',
      '      operationId: listAccounts',
      '      responses:',
      "        '200':",
      '          description: OK',
      'components:',
      '  schemas:',
      '    Account:',
      '      type: object',
      '      properties:',
      '        id:',
      '          type: integer',
      '```'
    ].join('\n');
    fakeGen.queueResponse(openApiWithMismatch);

    const openApiProjRes = await app.inject({
      method: 'POST',
      url: `/api/baselines/${baselineDto.id}/projections`,
      payload: {
        artifactType: 'openapi'
      }
    });
    expect(openApiProjRes.statusCode).toBe(200);

    // 5. Verify cross-validation contradiction finding was created and saved
    const findings = await repo.listCandidateFindings();
    const contradictionFinding = findings.find(
      (f) => f.type === 'contradiction' && f.rationale?.includes("defines 'id' as type 'integer'")
    );
    expect(contradictionFinding).toBeDefined();
    expect(contradictionFinding?.discoveredBy).toBe('artifact-validation');
    expect(contradictionFinding?.disposition).toBe('OPEN');
  });
});
