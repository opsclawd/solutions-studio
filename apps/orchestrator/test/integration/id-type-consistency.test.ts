import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import yaml from 'yaml';
import {
  createRequirementId,
  createRequirementRevisionId,
  createRequirementsBaselineId,
  createRequirementsBaseline,
  createReviewerId,
  createInstant,
  createRequirementRevision,
  createEngineeringDecision,
  createEngineeringDecisionId
} from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeGenerationGateway } from '../fakes/FakeGenerationGateway.js';
import { FakeOpenApiValidatorGateway } from '../fakes/FakeOpenApiValidatorGateway.js';
import { PGliteSqlValidatorAdapter } from '../../src/infrastructure/validation/PGliteSqlValidatorAdapter.js';
import { OpenApiStructuralValidatorAdapter } from '../../src/infrastructure/validation/OpenApiStructuralValidatorAdapter.js';
import { GenerateSqlSchemaProjectionUseCase } from '../../src/application/use-cases/GenerateSqlSchemaProjectionUseCase.js';
import { GenerateOpenApiProjectionUseCase } from '../../src/application/use-cases/GenerateOpenApiProjectionUseCase.js';
import { parseSqlTables } from '../../src/application/use-cases/crossValidation/schemaApiCrossValidator.js';
import {
  UnknownProjectionError,
  ProjectionBaselineMismatchError,
  ProjectionArtifactTypeMismatchError,
  ConflictingSqlProjectionAuthorityError
} from '../../src/application/use-cases/DiscoveryErrors.js';
import type { ProjectionRecord } from '../../src/application/ports/persistence/IRequirementsRepository.js';

function extractNormalizedSqlPrimaryKeyType(
  sqlContent: string,
  tableName: string
): 'uuid' | 'integer' {
  const tables = parseSqlTables(sqlContent);
  const table = tables.find((t) => t.name.toLowerCase() === tableName.toLowerCase());
  if (!table) throw new Error(`Table '${tableName}' not found in SQL content`);
  if (table.primaryKeyColumns.length === 0)
    throw new Error(`No primary key found for table '${tableName}'`);
  const pkColName = table.primaryKeyColumns[0];
  const pkCol = table.columns.find((c) => c.name.toLowerCase() === pkColName.toLowerCase());
  if (!pkCol) throw new Error(`Column '${pkColName}' not found in table '${tableName}'`);
  const upper = pkCol.type.toUpperCase();
  if (upper.includes('UUID')) return 'uuid';
  if (
    upper.includes('BIGINT') ||
    upper.includes('INT') ||
    upper.includes('SERIAL') ||
    upper.includes('IDENTITY')
  )
    return 'integer';
  throw new Error(`Unrecognized SQL primary key type: '${pkCol.type}'`);
}

function extractNormalizedOpenApiIdentifierType(
  openApiContent: string,
  schemaName: string
): 'uuid' | 'integer' {
  const parsed = yaml.parse(openApiContent) as Record<string, any>;
  const schema = parsed?.components?.schemas?.[schemaName];
  if (!schema) throw new Error(`Schema '${schemaName}' not found in OpenAPI components`);
  const properties = schema.properties ?? {};
  const idProp =
    properties.id ??
    properties[`${schemaName.toLowerCase()}_id`] ??
    Object.entries(properties).find(
      ([k]) => k.toLowerCase().endsWith('_id') || k.toLowerCase() === 'id'
    )?.[1];
  if (!idProp) throw new Error(`Identifier property not found in schema '${schemaName}'`);
  if (idProp.type === 'string' && idProp.format === 'uuid') return 'uuid';
  if (idProp.type === 'integer') return 'integer';
  throw new Error(`Unrecognized OpenAPI identifier property shape: ${JSON.stringify(idProp)}`);
}

describe(
  'Integration: Primary-Key Identifier Type Consistency across SQL and OpenAPI Projections (Phase 3.9)',
  { timeout: 30000 },
  () => {
    let tempDir: string;
    let repo: FilesystemRequirementsRepository;
    let fakeGen: FakeGenerationGateway;
    let sqlValidator: PGliteSqlValidatorAdapter;
    let openApiValidator: OpenApiStructuralValidatorAdapter;
    let sqlUseCase: GenerateSqlSchemaProjectionUseCase;
    let openApiUseCase: GenerateOpenApiProjectionUseCase;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'id-type-consistency-test-'));
      repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
      fakeGen = new FakeGenerationGateway();
      sqlValidator = new PGliteSqlValidatorAdapter();
      openApiValidator = new OpenApiStructuralValidatorAdapter();
      sqlUseCase = new GenerateSqlSchemaProjectionUseCase(fakeGen, sqlValidator, repo, 'fake');
      openApiUseCase = new GenerateOpenApiProjectionUseCase(
        fakeGen,
        openApiValidator,
        repo,
        'fake'
      );
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('Scenario 1: Same-run invocation with default UUID convention ensures identifier consistency and passes cross-validation with 0 contradictions', async () => {
      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-ORD-01-R1'),
        requirementId: createRequirementId('REQ-ORD-01'),
        revision: 1,
        statement: 'Orders must record customer ID and status',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR'
      });
      await repo.saveRequirementRevision(rev1);

      const baseline = createRequirementsBaseline({
        id: createRequirementsBaselineId('BASE-ORD-001'),
        requirements: [rev1],
        createdBy: createReviewerId('REV-LEAD'),
        createdAt: createInstant('2026-09-18T12:00:00.000Z')
      });
      await repo.saveRequirementsBaseline(baseline);

      // 1. Generate SQL schema projection with default UUID convention
      const validSql = [
        '-- @baseline BASE-ORD-001',
        '-- @requirements REQ-ORD-01-R1',
        '',
        'CREATE TABLE orders (',
        '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
        '  customer_id VARCHAR(64) NOT NULL',
        ');'
      ].join('\n');
      fakeGen.queueResponse(`\`\`\`sql\n${validSql}\n\`\`\``);

      const sqlResult = await sqlUseCase.execute({
        baselineId: baseline.id
      });

      // Assert SQL generator prompt includes default UUID surrogate key convention
      const sqlPrompt = fakeGen.recordedRequests[0].prompt;
      expect(sqlPrompt).toContain('Primary Key & Surrogate Key Strategy:');
      expect(sqlPrompt).toContain(
        "use UUID surrogate primary keys ('id UUID PRIMARY KEY DEFAULT gen_random_uuid()')"
      );

      // 2. Generate OpenAPI projection referencing SQL projection
      const validOpenApi = [
        '# @baseline BASE-ORD-001',
        '# @requirements REQ-ORD-01-R1',
        'openapi: 3.1.0',
        'info:',
        '  title: Orders Service API',
        '  version: 1.0.0',
        'paths:',
        '  /orders:',
        '    get:',
        '      operationId: listOrders',
        '      responses:',
        "        '200':",
        '          description: OK',
        'components:',
        '  schemas:',
        '    Order:',
        '      type: object',
        '      required:',
        '        - id',
        '        - customer_id',
        '      properties:',
        '        id:',
        '          type: string',
        '          format: uuid',
        '        customer_id:',
        '          type: string'
      ].join('\n');
      fakeGen.queueResponse(`\`\`\`yaml\n${validOpenApi}\n\`\`\``);

      const openApiResult = await openApiUseCase.execute({
        baselineId: baseline.id,
        sqlSchemaProjectionId: sqlResult.projectionId
      });

      // Assert OpenAPI generator prompt was injected with SQL relational context
      const openApiPrompt = fakeGen.recordedRequests[1].prompt;
      expect(openApiPrompt).toContain(
        `Relational Schema Context (from SQL projection ${sqlResult.projectionId}):`
      );
      expect(openApiPrompt).toContain("Table 'orders': Primary key column 'id' (Type: UUID)");
      expect(openApiPrompt).toContain(
        "If SQL primary key is UUID: OpenAPI schema property must be type 'string' with format 'uuid'."
      );

      // 3. Assert zero contradiction candidate findings
      const contradictionFindings = (openApiResult.candidateFindings ?? []).filter(
        (f) => f.type === 'contradiction'
      );
      expect(contradictionFindings).toHaveLength(0);

      // 4. Directly parse and assert normalized PK and OpenAPI identifier types are EQUAL
      const sqlPkType = extractNormalizedSqlPrimaryKeyType(sqlResult.content, 'orders');
      const openApiIdType = extractNormalizedOpenApiIdentifierType(openApiResult.content, 'Order');
      expect(sqlPkType).toBe('uuid');
      expect(openApiIdType).toBe('uuid');
      expect(openApiIdType).toBe(sqlPkType);
    });

    it('Scenario 2: Propagation of BIGINT primary key decision from SQL schema to OpenAPI projection aligns types and avoids contradiction', async () => {
      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-ORD-02-R1'),
        requirementId: createRequirementId('REQ-ORD-02'),
        revision: 1,
        statement: 'Orders must record customer ID and status with high throughput',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR'
      });
      await repo.saveRequirementRevision(rev1);

      const baseline = createRequirementsBaseline({
        id: createRequirementsBaselineId('BASE-ORD-002'),
        requirements: [rev1],
        createdBy: createReviewerId('REV-LEAD'),
        createdAt: createInstant('2026-09-18T12:00:00.000Z')
      });
      await repo.saveRequirementsBaseline(baseline);

      // 1. Generate SQL schema projection with BIGINT identity surrogate key decision
      const sqlWithBigInt = [
        '-- @baseline BASE-ORD-002',
        '-- @requirements REQ-ORD-02-R1',
        '-- @decision: Use BIGINT GENERATED ALWAYS AS IDENTITY for primary keys | Provides a standard, high-performance sequential surrogate key',
        '',
        'CREATE TABLE orders (',
        '  order_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,',
        '  customer_id VARCHAR(64) NOT NULL',
        ');'
      ].join('\n');
      fakeGen.queueResponse(`\`\`\`sql\n${sqlWithBigInt}\n\`\`\``);

      const sqlResult = await sqlUseCase.execute({
        baselineId: baseline.id
      });

      // 2. Generate OpenAPI projection referencing the SQL projection
      const openApiWithIntegerId = [
        '# @baseline BASE-ORD-002',
        '# @requirements REQ-ORD-02-R1',
        'openapi: 3.1.0',
        'info:',
        '  title: Orders Service API',
        '  version: 1.0.0',
        'paths:',
        '  /orders:',
        '    get:',
        '      operationId: listOrders',
        '      responses:',
        "        '200':",
        '          description: OK',
        'components:',
        '  schemas:',
        '    Order:',
        '      type: object',
        '      required:',
        '        - order_id',
        '        - customer_id',
        '      properties:',
        '        order_id:',
        '          type: integer',
        '        customer_id:',
        '          type: string'
      ].join('\n');
      fakeGen.queueResponse(`\`\`\`yaml\n${openApiWithIntegerId}\n\`\`\``);

      const openApiResult = await openApiUseCase.execute({
        baselineId: baseline.id,
        sqlSchemaProjectionId: sqlResult.projectionId
      });

      // Assert OpenAPI prompt received the BIGINT schema context and decision
      const openApiPrompt = fakeGen.recordedRequests[1].prompt;
      expect(openApiPrompt).toContain(
        `Relational Schema Context (from SQL projection ${sqlResult.projectionId}):`
      );
      expect(openApiPrompt).toContain(
        "Table 'orders': Primary key column 'order_id' (Type: BIGINT)"
      );
      expect(openApiPrompt).toContain(
        'Use BIGINT GENERATED ALWAYS AS IDENTITY for primary keys | Provides a standard, high-performance sequential surrogate key'
      );
      expect(openApiPrompt).toContain(
        "If SQL primary key is integer/BIGINT/SERIAL: OpenAPI schema property must be type 'integer'."
      );

      // 3. Assert zero contradiction candidate findings
      const contradictionFindings = (openApiResult.candidateFindings ?? []).filter(
        (f) => f.type === 'contradiction'
      );
      expect(contradictionFindings).toHaveLength(0);

      // 4. Directly parse and assert normalized PK and OpenAPI identifier types are EQUAL
      const sqlPkType = extractNormalizedSqlPrimaryKeyType(sqlResult.content, 'orders');
      const openApiIdType = extractNormalizedOpenApiIdentifierType(openApiResult.content, 'Order');
      expect(sqlPkType).toBe('integer');
      expect(openApiIdType).toBe('integer');
      expect(openApiIdType).toBe(sqlPkType);
    });

    it('Scenario 3: Enforcement of explicit accepted EngineeringDecision mandates compliance in both SQL and OpenAPI prompts', async () => {
      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-ORD-03-R1'),
        requirementId: createRequirementId('REQ-ORD-03'),
        revision: 1,
        statement: 'Orders must record customer ID and status',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR'
      });
      await repo.saveRequirementRevision(rev1);

      const baseline = createRequirementsBaseline({
        id: createRequirementsBaselineId('BASE-ORD-003'),
        requirements: [rev1],
        createdBy: createReviewerId('REV-LEAD'),
        createdAt: createInstant('2026-09-18T12:00:00.000Z')
      });
      await repo.saveRequirementsBaseline(baseline);

      // Formalize accepted EngineeringDecision ED-001
      const acceptedDecision = createEngineeringDecision({
        id: createEngineeringDecisionId('ED-001'),
        baselineId: baseline.id,
        statement: 'Use BIGINT GENERATED ALWAYS AS IDENTITY for primary keys',
        rationale: 'High throughput sequential surrogate keys for performance',
        requirementRevisionIds: [rev1.id],
        policyConstraintRevisionIds: [],
        state: 'ACCEPTED',
        acceptedBy: createReviewerId('REV-LEAD'),
        acceptedAt: createInstant('2026-09-18T12:00:00.000Z'),
        createdBy: 'ARCH-LEAD'
      });
      await repo.saveEngineeringDecision(acceptedDecision);

      // 1. Generate SQL
      const sqlContent = [
        '-- @baseline BASE-ORD-003',
        '-- @requirements REQ-ORD-03-R1',
        '-- @engineering-decisions ED-001',
        '',
        'CREATE TABLE orders (',
        '  order_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,',
        '  customer_id VARCHAR(64) NOT NULL',
        ');'
      ].join('\n');
      fakeGen.queueResponse(`\`\`\`sql\n${sqlContent}\n\`\`\``);

      const sqlResult = await sqlUseCase.execute({
        baselineId: baseline.id,
        engineeringDecisionIds: [acceptedDecision.id]
      });

      const sqlPrompt = fakeGen.recordedRequests[0].prompt;
      expect(sqlPrompt).toContain(
        'MUST strictly comply with and implement all Accepted Engineering Decisions above (including primary key types, surrogate key strategies, and column naming).'
      );
      expect(sqlPrompt).toContain('ED-001');

      // 2. Generate OpenAPI
      const openApiContent = [
        '# @baseline BASE-ORD-003',
        '# @requirements REQ-ORD-03-R1',
        '# @engineering-decisions ED-001',
        'openapi: 3.1.0',
        'info:',
        '  title: Orders Service API',
        '  version: 1.0.0',
        'paths:',
        '  /orders:',
        '    get:',
        '      operationId: listOrders',
        '      responses:',
        "        '200':",
        '          description: OK',
        'components:',
        '  schemas:',
        '    Order:',
        '      type: object',
        '      required:',
        '        - order_id',
        '        - customer_id',
        '      properties:',
        '        order_id:',
        '          type: integer',
        '        customer_id:',
        '          type: string'
      ].join('\n');
      fakeGen.queueResponse(`\`\`\`yaml\n${openApiContent}\n\`\`\``);

      const openApiResult = await openApiUseCase.execute({
        baselineId: baseline.id,
        engineeringDecisionIds: [acceptedDecision.id],
        sqlSchemaProjectionId: sqlResult.projectionId
      });

      const openApiPrompt = fakeGen.recordedRequests[1].prompt;
      expect(openApiPrompt).toContain(
        'MUST strictly comply with and implement all Accepted Engineering Decisions above (including primary key types and surrogate key strategies).'
      );
      expect(openApiPrompt).toContain('ED-001');

      // 3. Assert zero contradiction candidate findings
      const contradictionFindings = (openApiResult.candidateFindings ?? []).filter(
        (f) => f.type === 'contradiction'
      );
      expect(contradictionFindings).toHaveLength(0);

      // 4. Directly parse and assert normalized PK and OpenAPI identifier types are EQUAL
      const sqlPkType = extractNormalizedSqlPrimaryKeyType(sqlResult.content, 'orders');
      const openApiIdType = extractNormalizedOpenApiIdentifierType(openApiResult.content, 'Order');
      expect(sqlPkType).toBe('integer');
      expect(openApiIdType).toBe('integer');
      expect(openApiIdType).toBe(sqlPkType);
    });

    it('Scenario 4: Regression check catches intentional primary-key identifier type mismatch (BIGINT vs uuid)', async () => {
      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-ORD-04-R1'),
        requirementId: createRequirementId('REQ-ORD-04'),
        revision: 1,
        statement: 'Orders must record customer ID and status',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR'
      });
      await repo.saveRequirementRevision(rev1);

      const baseline = createRequirementsBaseline({
        id: createRequirementsBaselineId('BASE-ORD-004'),
        requirements: [rev1],
        createdBy: createReviewerId('REV-LEAD'),
        createdAt: createInstant('2026-09-18T12:00:00.000Z')
      });
      await repo.saveRequirementsBaseline(baseline);

      // SQL defines order_id as BIGINT
      const sqlWithBigInt = [
        '-- @baseline BASE-ORD-004',
        '-- @requirements REQ-ORD-04-R1',
        '-- @decision: Use BIGINT GENERATED ALWAYS AS IDENTITY for primary keys | Provides a standard, high-performance sequential surrogate key',
        '',
        'CREATE TABLE orders (',
        '  order_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,',
        '  customer_id VARCHAR(64) NOT NULL',
        ');'
      ].join('\n');
      fakeGen.queueResponse(`\`\`\`sql\n${sqlWithBigInt}\n\`\`\``);

      const sqlResult = await sqlUseCase.execute({
        baselineId: baseline.id
      });

      // OpenAPI contract deliberately diverges and defines id with format: uuid
      const openApiWithUuid = [
        '# @baseline BASE-ORD-004',
        '# @requirements REQ-ORD-04-R1',
        'openapi: 3.1.0',
        'info:',
        '  title: Orders Service API',
        '  version: 1.0.0',
        'paths:',
        '  /orders:',
        '    get:',
        '      operationId: listOrders',
        '      responses:',
        "        '200':",
        '          description: OK',
        'components:',
        '  schemas:',
        '    Order:',
        '      type: object',
        '      required:',
        '        - id',
        '        - customer_id',
        '      properties:',
        '        id:',
        '          type: string',
        '          format: uuid',
        '        customer_id:',
        '          type: string'
      ].join('\n');
      fakeGen.queueResponse(`\`\`\`yaml\n${openApiWithUuid}\n\`\`\``);

      const openApiResult = await openApiUseCase.execute({
        baselineId: baseline.id,
        sqlSchemaProjectionId: sqlResult.projectionId
      });

      // Assert that SchemaApiCrossValidator catches this exact contradiction
      expect(openApiResult.candidateFindings).toBeDefined();
      const contradictionFinding = openApiResult.candidateFindings!.find(
        (f) =>
          f.type === 'contradiction' &&
          f.rationale?.includes("Identifier type contradiction for entity 'orders'")
      );
      expect(contradictionFinding).toBeDefined();
      expect(contradictionFinding?.rationale).toBe(
        "Identifier type contradiction for entity 'orders': OpenAPI contract defines 'id' with format 'uuid', but SQL schema defines primary key column 'order_id' as 'BIGINT'."
      );
      expect(contradictionFinding?.disposition).toBe('OPEN');
      expect(contradictionFinding?.discoveredBy).toBe('artifact-validation');
    });

    it('Scenario 5: Automatic fallback selects chronologically newest SQL projection (creation order vs alphabetical ID order)', async () => {
      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-ORD-05-R1'),
        requirementId: createRequirementId('REQ-ORD-05'),
        revision: 1,
        statement: 'Orders table creation',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR'
      });
      await repo.saveRequirementRevision(rev1);

      const baseline = createRequirementsBaseline({
        id: createRequirementsBaselineId('BASE-ORD-005'),
        requirements: [rev1],
        createdBy: createReviewerId('REV-LEAD'),
        createdAt: createInstant('2026-09-18T10:00:00.000Z')
      });
      await repo.saveRequirementsBaseline(baseline);

      // Older projection with alphabetically later ID ('PROJ-SQL-ZZZ-OLDER')
      const olderSql: ProjectionRecord = {
        id: 'PROJ-SQL-ZZZ-OLDER',
        baselineId: baseline.id,
        requirementRevisionIds: baseline.requirementRevisions,
        artifactType: 'sql-schema',
        content: [
          '-- @baseline BASE-ORD-005',
          'CREATE TABLE orders (',
          '  order_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY',
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
            verifiedAt: createInstant('2026-09-18T10:00:00.000Z')
          }
        },
        createdAt: createInstant('2026-09-18T10:00:00.000Z')
      };
      await repo.saveProjectionRecord(olderSql);

      // Newer projection with alphabetically earlier ID ('PROJ-SQL-AAA-NEWER')
      const newerSql: ProjectionRecord = {
        id: 'PROJ-SQL-AAA-NEWER',
        baselineId: baseline.id,
        requirementRevisionIds: baseline.requirementRevisions,
        artifactType: 'sql-schema',
        content: [
          '-- @baseline BASE-ORD-005',
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
            contentHash: 'h2',
            verifiedAt: createInstant('2026-09-18T12:00:00.000Z')
          }
        },
        createdAt: createInstant('2026-09-18T12:00:00.000Z')
      };
      await repo.saveProjectionRecord(newerSql);

      const openApiContent = [
        '# @baseline BASE-ORD-005',
        '# @requirements REQ-ORD-05-R1',
        'openapi: 3.1.0',
        'info:',
        '  title: Orders Service API',
        '  version: 1.0.0',
        'paths:',
        '  /orders:',
        '    get:',
        '      operationId: listOrders',
        '      responses:',
        "        '200':",
        '          description: OK',
        'components:',
        '  schemas:',
        '    Order:',
        '      type: object',
        '      required:',
        '        - id',
        '        - status',
        '      properties:',
        '        id:',
        '          type: string',
        '          format: uuid',
        '        status:',
        '          type: string'
      ].join('\n');
      fakeGen.queueResponse(`\`\`\`yaml\n${openApiContent}\n\`\`\``);

      // Omit sqlSchemaProjectionId to test automatic repository fallback selection
      const openApiResult = await openApiUseCase.execute({
        baselineId: baseline.id
      });

      const openApiPrompt = fakeGen.recordedRequests[0].prompt;
      // Must select PROJ-SQL-AAA-NEWER by createdAt descending, NOT PROJ-SQL-ZZZ-OLDER
      expect(openApiPrompt).toContain('PROJ-SQL-AAA-NEWER');
      expect(openApiPrompt).toContain("Table 'orders': Primary key column 'id' (Type: UUID)");
      expect(openApiPrompt).not.toContain('PROJ-SQL-ZZZ-OLDER');
      // Assert the selected projection's actual relational schema context contains id and status, and not order_id
      const relationalContextMatch = openApiPrompt.match(
        /Relational Schema Context[\s\S]*?(?=OpenAPI Identifier Alignment Requirements|$)/i
      );
      const relationalContext = relationalContextMatch ? relationalContextMatch[0] : openApiPrompt;
      expect(relationalContext).toContain("Table 'orders': Primary key column 'id' (Type: UUID)");
      expect(relationalContext).toContain("- 'id': UUID");
      expect(relationalContext).toContain("- 'status': VARCHAR(32)");
      expect(relationalContext).not.toContain('order_id');

      const sqlPkType = extractNormalizedSqlPrimaryKeyType(newerSql.content, 'orders');
      const openApiIdType = extractNormalizedOpenApiIdentifierType(openApiResult.content, 'Order');
      expect(sqlPkType).toBe('uuid');
      expect(openApiIdType).toBe('uuid');
      expect(openApiIdType).toBe(sqlPkType);
    });

    it('Scenario 6: Explicit invalid SQL projection context fails closed before generation with typed errors', async () => {
      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-ORD-06-R1'),
        requirementId: createRequirementId('REQ-ORD-06'),
        revision: 1,
        statement: 'Orders validation',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR'
      });
      await repo.saveRequirementRevision(rev1);

      const baselineA = createRequirementsBaseline({
        id: createRequirementsBaselineId('BASE-ORD-006A'),
        requirements: [rev1],
        createdBy: createReviewerId('REV-LEAD')
      });
      const baselineB = createRequirementsBaseline({
        id: createRequirementsBaselineId('BASE-ORD-006B'),
        requirements: [rev1],
        createdBy: createReviewerId('REV-LEAD')
      });
      await repo.saveRequirementsBaseline(baselineA);
      await repo.saveRequirementsBaseline(baselineB);

      // 1. Missing projection ID
      await expect(
        openApiUseCase.execute({
          baselineId: baselineA.id,
          sqlSchemaProjectionId: 'PROJ-NONEXISTENT'
        })
      ).rejects.toThrow(UnknownProjectionError);

      // 2. Foreign baseline projection ID
      const foreignSql: ProjectionRecord = {
        id: 'PROJ-FOREIGN-SQL',
        baselineId: baselineB.id,
        requirementRevisionIds: baselineB.requirementRevisions,
        artifactType: 'sql-schema',
        content: 'CREATE TABLE foreign_tbl (id UUID PRIMARY KEY);',
        metadata: {
          baselineId: baselineB.id,
          requirementRevisionIds: [...baselineB.requirementRevisions],
          artifactType: 'sql-schema',
          declaredProvenance: {
            baselineId: baselineB.id,
            requirementRevisionIds: [...baselineB.requirementRevisions]
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
      await repo.saveProjectionRecord(foreignSql);

      await expect(
        openApiUseCase.execute({
          baselineId: baselineA.id,
          sqlSchemaProjectionId: foreignSql.id
        })
      ).rejects.toThrow(ProjectionBaselineMismatchError);

      // 3. Non-SQL artifact projection ID
      const nonSqlRecord: ProjectionRecord = {
        id: 'PROJ-DIAGRAM',
        baselineId: baselineA.id,
        requirementRevisionIds: baselineA.requirementRevisions,
        artifactType: 'process-diagram',
        content: 'graph TD; A-->B;',
        metadata: {
          baselineId: baselineA.id,
          requirementRevisionIds: [...baselineA.requirementRevisions],
          artifactType: 'process-diagram',
          declaredProvenance: {
            baselineId: baselineA.id,
            requirementRevisionIds: [...baselineA.requirementRevisions]
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
      await repo.saveProjectionRecord(nonSqlRecord);

      await expect(
        openApiUseCase.execute({
          baselineId: baselineA.id,
          sqlSchemaProjectionId: nonSqlRecord.id
        })
      ).rejects.toThrow(ProjectionArtifactTypeMismatchError);
    });

    it('Scenario 7: Conflicting authority between accepted EngineeringDecision and SQL projection fails closed', async () => {
      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-ORD-07-R1'),
        requirementId: createRequirementId('REQ-ORD-07'),
        revision: 1,
        statement: 'Orders authority check',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR'
      });
      await repo.saveRequirementRevision(rev1);

      const baseline = createRequirementsBaseline({
        id: createRequirementsBaselineId('BASE-ORD-007'),
        requirements: [rev1],
        createdBy: createReviewerId('REV-LEAD')
      });
      await repo.saveRequirementsBaseline(baseline);

      const sqlWithBigInt: ProjectionRecord = {
        id: 'PROJ-SQL-BIGINT-CONFLICT',
        baselineId: baseline.id,
        requirementRevisionIds: baseline.requirementRevisions,
        artifactType: 'sql-schema',
        content: [
          '-- @baseline BASE-ORD-007',
          'CREATE TABLE orders (',
          '  order_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY',
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
      await repo.saveProjectionRecord(sqlWithBigInt);

      // Accepted decision mandates UUID
      const uuidDecision = createEngineeringDecision({
        id: createEngineeringDecisionId('ED-ORD-UUID'),
        baselineId: baseline.id,
        statement: 'Use UUID primary keys with gen_random_uuid() for all entity tables',
        rationale: 'UUID standardization',
        requirementRevisionIds: [rev1.id],
        policyConstraintRevisionIds: [],
        state: 'ACCEPTED',
        acceptedBy: createReviewerId('REV-LEAD'),
        acceptedAt: createInstant('2026-09-18T12:00:00.000Z'),
        createdBy: 'ARCH'
      });
      await repo.saveEngineeringDecision(uuidDecision);

      await expect(
        openApiUseCase.execute({
          baselineId: baseline.id,
          sqlSchemaProjectionId: sqlWithBigInt.id,
          engineeringDecisionIds: [uuidDecision.id]
        })
      ).rejects.toThrow(ConflictingSqlProjectionAuthorityError);
    });

    it('Scenario 8: Repair retry carries relational SQL context to the OpenAPI generator prompt', async () => {
      // Use fake validator to simulate 1 repair attempt
      const testFakeValidator = new FakeOpenApiValidatorGateway();
      testFakeValidator.failNextNTimes(1, 'OpenAPI schema validation failed: syntax error');

      const testOpenApiUseCase = new GenerateOpenApiProjectionUseCase(
        fakeGen,
        testFakeValidator,
        repo,
        'fake'
      );

      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-ORD-08-R1'),
        requirementId: createRequirementId('REQ-ORD-08'),
        revision: 1,
        statement: 'Orders repair check',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR'
      });
      await repo.saveRequirementRevision(rev1);

      const baseline = createRequirementsBaseline({
        id: createRequirementsBaselineId('BASE-ORD-008'),
        requirements: [rev1],
        createdBy: createReviewerId('REV-LEAD')
      });
      await repo.saveRequirementsBaseline(baseline);

      const sqlProjection: ProjectionRecord = {
        id: 'PROJ-SQL-RETRY',
        baselineId: baseline.id,
        requirementRevisionIds: baseline.requirementRevisions,
        artifactType: 'sql-schema',
        content: [
          '-- @baseline BASE-ORD-008',
          'CREATE TABLE orders (',
          '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
          '  amount NUMERIC(10,2) NOT NULL',
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

      const initialOpenApi = [
        '# @baseline BASE-ORD-008',
        '# @requirements REQ-ORD-08-R1',
        'openapi: 3.1.0',
        'info:',
        '  title: Orders Service API',
        '  version: 1.0.0',
        'paths: {}'
      ].join('\n');
      fakeGen.queueResponse(`\`\`\`yaml\n${initialOpenApi}\n\`\`\``);

      const repairedOpenApi = [
        '# @baseline BASE-ORD-008',
        '# @requirements REQ-ORD-08-R1',
        'openapi: 3.1.0',
        'info:',
        '  title: Orders Service API',
        '  version: 1.0.0',
        'paths:',
        '  /orders:',
        '    get:',
        '      responses:',
        "        '200':",
        '          description: OK',
        'components:',
        '  schemas:',
        '    Order:',
        '      type: object',
        '      required:',
        '        - id',
        '      properties:',
        '        id:',
        '          type: string',
        '          format: uuid'
      ].join('\n');
      fakeGen.queueResponse(`\`\`\`yaml\n${repairedOpenApi}\n\`\`\``);

      const result = await testOpenApiUseCase.execute({
        baselineId: baseline.id,
        sqlSchemaProjectionId: sqlProjection.id,
        options: { maxRepairAttempts: 2 }
      });

      expect(result.metadata.measuredVerification.repairsNeeded).toBe(1);
      expect(fakeGen.recordedRequests).toHaveLength(2);

      const repairPrompt = fakeGen.recordedRequests[1].prompt;
      expect(repairPrompt).toContain(
        'OpenAPI Identifier Alignment Requirements (MUST strictly match relational primary keys):'
      );
      expect(repairPrompt).toContain("Table 'orders': Primary key column 'id' (Type: UUID)");
      expect(repairPrompt).toContain(
        "If SQL primary key is UUID: OpenAPI schema property must be type 'string' with format 'uuid'."
      );

      const sqlPkType = extractNormalizedSqlPrimaryKeyType(sqlProjection.content, 'orders');
      const openApiIdType = extractNormalizedOpenApiIdentifierType(result.content, 'Order');
      expect(sqlPkType).toBe('uuid');
      expect(openApiIdType).toBe('uuid');
      expect(openApiIdType).toBe(sqlPkType);
    });
  }
);
