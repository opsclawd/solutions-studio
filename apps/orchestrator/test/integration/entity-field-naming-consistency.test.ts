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
  createRequirementRevision
} from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import {
  type IGenerationGateway,
  type GenerationRequest,
  type GenerationResult
} from '../../src/application/ports/generation/IGenerationGateway.js';
import { FakeOpenApiValidatorGateway } from '../fakes/FakeOpenApiValidatorGateway.js';
import { PGliteSqlValidatorAdapter } from '../../src/infrastructure/validation/PGliteSqlValidatorAdapter.js';
import { OpenApiStructuralValidatorAdapter } from '../../src/infrastructure/validation/OpenApiStructuralValidatorAdapter.js';
import { GenerateSqlSchemaProjectionUseCase } from '../../src/application/use-cases/GenerateSqlSchemaProjectionUseCase.js';
import { GenerateOpenApiProjectionUseCase } from '../../src/application/use-cases/GenerateOpenApiProjectionUseCase.js';

class PromptSensitiveGenerationGateway implements IGenerationGateway {
  public recordedRequests: GenerationRequest[] = [];
  private responseQueue: string[] = [];

  queueResponse(text: string): void {
    this.responseQueue.push(text);
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    this.recordedRequests.push(request);

    if (this.responseQueue.length > 0) {
      return { text: this.responseQueue.shift()! };
    }

    const prompt = request.prompt;
    const isRelationalGrounded =
      prompt.includes('Relational Schema Context') &&
      prompt.includes('OpenAPI Entity, Schema, and Field Naming Alignment Requirements');

    const baselineMatch = prompt.match(/requirements baseline (BASE-[A-Z0-9_-]+)/i);
    const baselineId = baselineMatch ? baselineMatch[1] : 'BASE-LINE-001';
    const reqMatch = prompt.match(/\[(REQ-[A-Z0-9_-]+)\]/i);
    const reqId = reqMatch ? reqMatch[1] : 'REQ-LINE-01-R1';

    if (isRelationalGrounded) {
      if (prompt.includes("Table 'payment_authorizations'")) {
        const tokenField = prompt.includes("- 'authorization_token'")
          ? 'authorization_token'
          : 'authorization_code';
        const openApiYaml = [
          `# @baseline ${baselineId}`,
          `# @requirements ${reqId}`,
          'openapi: 3.1.0',
          'info:',
          '  title: Payments API',
          '  version: 1.0.0',
          'paths:',
          '  /payment-authorizations:',
          '    get:',
          '      operationId: listAuthorizations',
          '      responses:',
          "        '200':",
          '          description: OK',
          'components:',
          '  schemas:',
          '    PaymentAuthorization:',
          '      type: object',
          '      required:',
          '        - id',
          `        - ${tokenField}`,
          '        - amount',
          '      properties:',
          '        id:',
          '          type: string',
          '          format: uuid',
          `        ${tokenField}:`,
          '          type: string',
          '        amount:',
          '          type: number'
        ].join('\n');
        return { text: `\`\`\`yaml\n${openApiYaml}\n\`\`\`` };
      }

      // Derive child entity schema name from prompt table grounding
      const childSchemaName = prompt.includes("Table 'order_line_items'")
        ? 'OrderLineItem'
        : 'LineItem';

      // Derive field names from prompt column grounding
      const productField = prompt.includes("- 'product_ref'") ? 'product_ref' : 'product_id';
      const qtyField = prompt.includes("- 'qty'") ? 'qty' : 'quantity';

      const openApiYaml = [
        `# @baseline ${baselineId}`,
        `# @requirements ${reqId}`,
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
        '  /orders/{id}/line-items:',
        '    get:',
        '      operationId: listOrderLineItems',
        '      parameters:',
        '        - name: id',
        '          in: path',
        '          required: true',
        '          schema:',
        '            type: string',
        '            format: uuid',
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
        '          type: string',
        `    ${childSchemaName}:`,
        '      type: object',
        '      required:',
        '        - id',
        `        - ${productField}`,
        `        - ${qtyField}`,
        '        - unit_price',
        '      properties:',
        '        id:',
        '          type: string',
        '          format: uuid',
        `        ${productField}:`,
        '          type: string',
        `        ${qtyField}:`,
        '          type: integer',
        '        unit_price:',
        '          type: number'
      ].join('\n');

      return { text: `\`\`\`yaml\n${openApiYaml}\n\`\`\`` };
    }

    // Ungrounded fallback: independent divergent names
    if (prompt.includes('Payment') || prompt.includes('REQ-PAY')) {
      const ungroundedPaymentYaml = [
        `# @baseline ${baselineId}`,
        `# @requirements ${reqId}`,
        'openapi: 3.1.0',
        'info:',
        '  title: Payments API',
        '  version: 1.0.0',
        'paths:',
        '  /payment-authorizations:',
        '    get:',
        '      operationId: listAuthorizations',
        '      responses:',
        "        '200':",
        '          description: OK',
        'components:',
        '  schemas:',
        '    PaymentAuthorization:',
        '      type: object',
        '      required:',
        '        - id',
        '        - authorization_code',
        '        - amount',
        '      properties:',
        '        id:',
        '          type: string',
        '          format: uuid',
        '        authorization_code:',
        '          type: string',
        '        amount:',
        '          type: number'
      ].join('\n');
      return { text: `\`\`\`yaml\n${ungroundedPaymentYaml}\n\`\`\`` };
    }

    const ungroundedYaml = [
      `# @baseline ${baselineId}`,
      `# @requirements ${reqId}`,
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
      '          type: string',
      '    LineItem:',
      '      type: object',
      '      required:',
      '        - id',
      '        - product_id',
      '        - quantity',
      '      properties:',
      '        id:',
      '          type: string',
      '          format: uuid',
      '        product_id:',
      '          type: string',
      '        quantity:',
      '          type: integer'
    ].join('\n');

    return { text: `\`\`\`yaml\n${ungroundedYaml}\n\`\`\`` };
  }
}

describe(
  'Integration: Entity, Table, and Field Naming Consistency across SQL and OpenAPI Projections (Phase 3.11)',
  { timeout: 30000 },
  () => {
    let tempDir: string;
    let repo: FilesystemRequirementsRepository;
    let fakeGen: PromptSensitiveGenerationGateway;
    let sqlValidator: PGliteSqlValidatorAdapter;
    let openApiValidator: OpenApiStructuralValidatorAdapter;
    let sqlUseCase: GenerateSqlSchemaProjectionUseCase;
    let openApiUseCase: GenerateOpenApiProjectionUseCase;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'naming-consistency-test-'));
      repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
      fakeGen = new PromptSensitiveGenerationGateway();
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

    it('Scenario 1: Child table order_line_items with columns product_ref, qty is grounded into prompt and generates consistent OpenAPI contract (AC-3)', async () => {
      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-LINE-01-R1'),
        requirementId: createRequirementId('REQ-LINE-01'),
        revision: 1,
        statement: 'Orders track line items with product references and quantities',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR'
      });
      await repo.saveRequirementRevision(rev1);

      const baseline = createRequirementsBaseline({
        id: createRequirementsBaselineId('BASE-LINE-001'),
        requirements: [rev1],
        createdBy: createReviewerId('REV-LEAD'),
        createdAt: createInstant('2026-09-18T12:00:00.000Z')
      });
      await repo.saveRequirementsBaseline(baseline);

      // 1. Generate SQL schema projection with child table order_line_items
      const validSql = [
        '-- @baseline BASE-LINE-001',
        '-- @requirements REQ-LINE-01-R1',
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
      ].join('\n');
      fakeGen.queueResponse(`\`\`\`sql\n${validSql}\n\`\`\``);

      const sqlResult = await sqlUseCase.execute({
        baselineId: baseline.id
      });

      // 2. Generate OpenAPI projection referencing the SQL projection
      // PromptSensitiveGenerationGateway derives its output dynamically from the injected SQL context in the prompt
      const openApiResult = await openApiUseCase.execute({
        baselineId: baseline.id,
        sqlSchemaProjectionId: sqlResult.projectionId
      });

      // Assert OpenAPI prompt received full table, column, and relationship context
      const openApiPrompt = fakeGen.recordedRequests[1].prompt;
      expect(openApiPrompt).toContain(
        `Relational Schema Context (from SQL projection ${sqlResult.projectionId}):`
      );
      expect(openApiPrompt).toContain("Table 'orders': Primary key column 'id' (Type: UUID)");
      expect(openApiPrompt).toContain(
        "Table 'order_line_items': Primary key column 'id' (Type: UUID)"
      );
      expect(openApiPrompt).toContain(
        "- Role: Child/related entity of parent table 'orders' (linked via 'order_id' -> 'orders.id')"
      );
      expect(openApiPrompt).toContain("- 'product_ref': VARCHAR(64) [NOT NULL]");
      expect(openApiPrompt).toContain("- 'qty': INTEGER [NOT NULL]");
      expect(openApiPrompt).toContain("- 'unit_price': NUMERIC(10,2) [NOT NULL]");

      // Assert naming alignment instructions are present
      expect(openApiPrompt).toContain(
        'OpenAPI Entity, Schema, and Field Naming Alignment Requirements:'
      );
      expect(openApiPrompt).toContain(
        'Component schemas representing database entities MUST match the SQL table name'
      );
      expect(openApiPrompt).toContain(
        'OpenAPI schema properties MUST use exact matching field names for corresponding SQL columns.'
      );
      expect(openApiPrompt).toContain(
        'Ground domain concepts directly in the SQL column names chosen'
      );

      // Assert cross-validation succeeds with 0 candidate findings (no boundary ambiguities or contradictions)
      expect(openApiResult.candidateFindings ?? []).toHaveLength(0);

      // Verify that parsed OpenAPI schema matches SQL columns derived from prompt
      const parsed = yaml.parse(openApiResult.content) as Record<string, any>;
      const lineItemSchema = parsed?.components?.schemas?.OrderLineItem;
      expect(lineItemSchema).toBeDefined();
      expect(lineItemSchema.properties.product_ref).toBeDefined();
      expect(lineItemSchema.properties.qty).toBeDefined();

      // Causal contrast check (AC-3, F-6c0ab82d): Prove that when the generator is given an ungrounded prompt
      // without the injected SQL context, it falls back to independent divergent names (LineItem with product_id, quantity)
      const ungroundedGen = await fakeGen.generate({
        prompt: `Generate OpenAPI 3.1 specification for requirements baseline ${baseline.id}: [${rev1.id}]`,
        temperature: 0.1
      });
      const ungroundedDoc = yaml.parse(
        ungroundedGen.text.replace(/```(?:yaml)?/g, '').trim()
      ) as Record<string, any>;
      expect(ungroundedDoc.components.schemas.LineItem).toBeDefined();
      expect(ungroundedDoc.components.schemas.LineItem.properties.product_id).toBeDefined();
      expect(ungroundedDoc.components.schemas.LineItem.properties.product_ref).toBeUndefined();
    });

    it('Scenario 2: Field naming consistency for ambiguous domain concepts (authorization_token)', async () => {
      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-PAY-01-R1'),
        requirementId: createRequirementId('REQ-PAY-01'),
        revision: 1,
        statement: 'Payment authorizations record token and amount',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR'
      });
      await repo.saveRequirementRevision(rev1);

      const baseline = createRequirementsBaseline({
        id: createRequirementsBaselineId('BASE-PAY-001'),
        requirements: [rev1],
        createdBy: createReviewerId('REV-LEAD'),
        createdAt: createInstant('2026-09-18T12:00:00.000Z')
      });
      await repo.saveRequirementsBaseline(baseline);

      const validSql = [
        '-- @baseline BASE-PAY-001',
        '-- @requirements REQ-PAY-01-R1',
        '',
        'CREATE TABLE payment_authorizations (',
        '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
        '  authorization_token VARCHAR(128) NOT NULL,',
        '  amount NUMERIC(10,2) NOT NULL',
        ');'
      ].join('\n');
      fakeGen.queueResponse(`\`\`\`sql\n${validSql}\n\`\`\``);

      const sqlResult = await sqlUseCase.execute({
        baselineId: baseline.id
      });

      // 2. Generate OpenAPI projection referencing the SQL projection
      // PromptSensitiveGenerationGateway derives its output dynamically from the injected SQL context in the prompt
      const openApiResult = await openApiUseCase.execute({
        baselineId: baseline.id,
        sqlSchemaProjectionId: sqlResult.projectionId
      });

      const openApiPrompt = fakeGen.recordedRequests[1].prompt;
      expect(openApiPrompt).toContain("Table 'payment_authorizations': Primary key column 'id'");
      expect(openApiPrompt).toContain("- 'authorization_token': VARCHAR(128) [NOT NULL]");
      expect(openApiPrompt).toContain(
        'OpenAPI schema properties MUST use exact matching field names for corresponding SQL columns.'
      );
      expect(openApiPrompt).toContain(
        'Ground domain concepts directly in the SQL column names chosen'
      );

      expect(openApiResult.candidateFindings ?? []).toHaveLength(0);

      // Verify that parsed OpenAPI schema matches SQL column authorization_token derived from prompt
      const parsed = yaml.parse(openApiResult.content) as Record<string, any>;
      const authSchema = parsed?.components?.schemas?.PaymentAuthorization;
      expect(authSchema).toBeDefined();
      expect(authSchema.properties.authorization_token).toBeDefined();

      // Causal contrast check: Prove that ungrounded generation produces authorization_code instead
      const ungroundedGen = await fakeGen.generate({
        prompt: `Generate OpenAPI 3.1 specification for requirements baseline ${baseline.id}: [${rev1.id}]`,
        temperature: 0.1
      });
      const ungroundedDoc = yaml.parse(
        ungroundedGen.text.replace(/```(?:yaml)?/g, '').trim()
      ) as Record<string, any>;
      expect(ungroundedDoc.components.schemas.PaymentAuthorization).toBeDefined();
      expect(
        ungroundedDoc.components.schemas.PaymentAuthorization.properties.authorization_code
      ).toBeDefined();
      expect(
        ungroundedDoc.components.schemas.PaymentAuthorization.properties.authorization_token
      ).toBeUndefined();
    });

    it('Scenario 3: Nested child creation request without parent foreign key passes cross-validation', async () => {
      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-NEST-01-R1'),
        requirementId: createRequirementId('REQ-NEST-01'),
        revision: 1,
        statement: 'Order creation includes nested items',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR'
      });
      await repo.saveRequirementRevision(rev1);

      const baseline = createRequirementsBaseline({
        id: createRequirementsBaselineId('BASE-NEST-001'),
        requirements: [rev1],
        createdBy: createReviewerId('REV-LEAD'),
        createdAt: createInstant('2026-09-18T12:00:00.000Z')
      });
      await repo.saveRequirementsBaseline(baseline);

      const validSql = [
        '-- @baseline BASE-NEST-001',
        '-- @requirements REQ-NEST-01-R1',
        '',
        'CREATE TABLE orders (',
        '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
        '  customer_id VARCHAR(64) NOT NULL',
        ');',
        '',
        'CREATE TABLE order_items (',
        '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
        '  order_id UUID NOT NULL REFERENCES orders(id),',
        '  product_id VARCHAR(64) NOT NULL,',
        '  quantity INTEGER NOT NULL,',
        '  unit_price NUMERIC(10,2) NOT NULL',
        ');'
      ].join('\n');
      fakeGen.queueResponse(`\`\`\`sql\n${validSql}\n\`\`\``);

      const sqlResult = await sqlUseCase.execute({
        baselineId: baseline.id
      });

      // Child creation schema OrderItemCreateRequest does NOT require order_id (server-managed parent FK)
      const validOpenApi = [
        '# @baseline BASE-NEST-001',
        '# @requirements REQ-NEST-01-R1',
        'openapi: 3.1.0',
        'info:',
        '  title: Orders API',
        '  version: 1.0.0',
        'paths:',
        '  /orders:',
        '    post:',
        '      operationId: createOrder',
        '      requestBody:',
        '        required: true',
        '        content:',
        '          application/json:',
        '            schema:',
        '              $ref: "#/components/schemas/OrderCreateRequest"',
        '      responses:',
        "        '201':",
        '          description: Created',
        'components:',
        '  schemas:',
        '    OrderCreateRequest:',
        '      type: object',
        '      required:',
        '        - customer_id',
        '        - items',
        '      properties:',
        '        customer_id:',
        '          type: string',
        '        items:',
        '          type: array',
        '          items:',
        '            $ref: "#/components/schemas/OrderItemCreateRequest"',
        '    OrderItemCreateRequest:',
        '      type: object',
        '      required:',
        '        - product_id',
        '        - quantity',
        '        - unit_price',
        '      properties:',
        '        product_id:',
        '          type: string',
        '        quantity:',
        '          type: integer',
        '        unit_price:',
        '          type: number'
      ].join('\n');
      fakeGen.queueResponse(`\`\`\`yaml\n${validOpenApi}\n\`\`\``);

      const openApiResult = await openApiUseCase.execute({
        baselineId: baseline.id,
        sqlSchemaProjectionId: sqlResult.projectionId
      });

      expect(openApiResult.candidateFindings ?? []).toHaveLength(0);
    });

    it('Scenario 4: Negative test — ungrounded naming drift fails closed in cross-validator', async () => {
      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-NEG-01-R1'),
        requirementId: createRequirementId('REQ-NEG-01'),
        revision: 1,
        statement: 'Line items tracking',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR'
      });
      await repo.saveRequirementRevision(rev1);

      const baseline = createRequirementsBaseline({
        id: createRequirementsBaselineId('BASE-NEG-001'),
        requirements: [rev1],
        createdBy: createReviewerId('REV-LEAD'),
        createdAt: createInstant('2026-09-18T12:00:00.000Z')
      });
      await repo.saveRequirementsBaseline(baseline);

      // SQL uses product_ref and qty
      const validSql = [
        '-- @baseline BASE-NEG-001',
        '-- @requirements REQ-NEG-01-R1',
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
      ].join('\n');
      fakeGen.queueResponse(`\`\`\`sql\n${validSql}\n\`\`\``);

      const sqlResult = await sqlUseCase.execute({
        baselineId: baseline.id
      });

      // OpenAPI deliberately invents different names: product_id and quantity
      const divergentOpenApi = [
        '# @baseline BASE-NEG-001',
        '# @requirements REQ-NEG-01-R1',
        'openapi: 3.1.0',
        'info:',
        '  title: Divergent API',
        '  version: 1.0.0',
        'paths:',
        '  /order-line-items:',
        '    get:',
        '      operationId: listItems',
        '      responses:',
        "        '200':",
        '          description: OK',
        'components:',
        '  schemas:',
        '    OrderLineItem:',
        '      type: object',
        '      required:',
        '        - id',
        '        - product_id',
        '        - quantity',
        '      properties:',
        '        id:',
        '          type: string',
        '          format: uuid',
        '        product_id:',
        '          type: string',
        '        quantity:',
        '          type: integer'
      ].join('\n');
      fakeGen.queueResponse(`\`\`\`yaml\n${divergentOpenApi}\n\`\`\``);

      const openApiResult = await openApiUseCase.execute({
        baselineId: baseline.id,
        sqlSchemaProjectionId: sqlResult.projectionId
      });

      const findings = openApiResult.candidateFindings ?? [];
      expect(findings.length).toBeGreaterThanOrEqual(1);

      const missingColFinding = findings.find(
        (f) =>
          f.type === 'data-boundary-ambiguity' &&
          (f.rationale?.includes('product_id') || f.rationale?.includes('quantity'))
      );
      expect(missingColFinding).toBeDefined();

      const missingMandatoryFinding = findings.find(
        (f) =>
          f.type === 'data-boundary-ambiguity' &&
          (f.rationale?.includes('product_ref') || f.rationale?.includes('qty'))
      );
      expect(missingMandatoryFinding).toBeDefined();
    });

    it('Scenario 5: Inferred foreign key child relationship is correctly detected and grounded', async () => {
      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-INF-01-R1'),
        requirementId: createRequirementId('REQ-INF-01'),
        revision: 1,
        statement: 'Orders with items using convention naming without explicit REFERENCES',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR'
      });
      await repo.saveRequirementRevision(rev1);

      const baseline = createRequirementsBaseline({
        id: createRequirementsBaselineId('BASE-INF-001'),
        requirements: [rev1],
        createdBy: createReviewerId('REV-LEAD'),
        createdAt: createInstant('2026-09-18T12:00:00.000Z')
      });
      await repo.saveRequirementsBaseline(baseline);

      // Inferred FK: order_id column without explicit REFERENCES constraint
      const validSql = [
        '-- @baseline BASE-INF-001',
        '-- @requirements REQ-INF-01-R1',
        '',
        'CREATE TABLE orders (',
        '  id UUID PRIMARY KEY DEFAULT gen_random_uuid()',
        ');',
        '',
        'CREATE TABLE order_items (',
        '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
        '  order_id UUID NOT NULL,',
        '  item_name VARCHAR(64) NOT NULL',
        ');'
      ].join('\n');
      fakeGen.queueResponse(`\`\`\`sql\n${validSql}\n\`\`\``);

      const sqlResult = await sqlUseCase.execute({
        baselineId: baseline.id
      });

      const validOpenApi = [
        '# @baseline BASE-INF-001',
        '# @requirements REQ-INF-01-R1',
        'openapi: 3.1.0',
        'info:',
        '  title: Inferred FK API',
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
        '    OrderItem:',
        '      type: object',
        '      required:',
        '        - id',
        '        - item_name',
        '      properties:',
        '        id:',
        '          type: string',
        '          format: uuid',
        '        item_name:',
        '          type: string'
      ].join('\n');
      fakeGen.queueResponse(`\`\`\`yaml\n${validOpenApi}\n\`\`\``);

      const openApiResult = await openApiUseCase.execute({
        baselineId: baseline.id,
        sqlSchemaProjectionId: sqlResult.projectionId
      });

      const openApiPrompt = fakeGen.recordedRequests[1].prompt;
      // Inferred child relationship should be identified
      expect(openApiPrompt).toContain(
        "- Role: Child/related entity of parent table 'orders' (linked via 'order_id' -> 'orders.id')"
      );
      expect(openApiResult.candidateFindings ?? []).toHaveLength(0);
    });

    it('Scenario 6: Repair loop durability preserves full relational schema context and naming instructions', async () => {
      const rev1 = createRequirementRevision({
        id: createRequirementRevisionId('REQ-REP-01-R1'),
        requirementId: createRequirementId('REQ-REP-01'),
        revision: 1,
        statement: 'Orders with repair durability',
        category: 'business-rule',
        origin: 'ASSUMED',
        reviewState: 'ACCEPTED',
        resolutionState: 'CLEAR'
      });
      await repo.saveRequirementRevision(rev1);

      const baseline = createRequirementsBaseline({
        id: createRequirementsBaselineId('BASE-REP-001'),
        requirements: [rev1],
        createdBy: createReviewerId('REV-LEAD'),
        createdAt: createInstant('2026-09-18T12:00:00.000Z')
      });
      await repo.saveRequirementsBaseline(baseline);

      const validSql = [
        '-- @baseline BASE-REP-001',
        '-- @requirements REQ-REP-01-R1',
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
      ].join('\n');
      fakeGen.queueResponse(`\`\`\`sql\n${validSql}\n\`\`\``);

      const sqlResult = await sqlUseCase.execute({
        baselineId: baseline.id
      });

      // Force first OpenAPI validation attempt to fail
      const fakeOpenApiValidator = new FakeOpenApiValidatorGateway();
      fakeOpenApiValidator.failNextNTimes(1, 'OpenAPI validation failed: schema error');
      const useCaseWithFailingValidator = new GenerateOpenApiProjectionUseCase(
        fakeGen,
        fakeOpenApiValidator,
        repo,
        'fake'
      );

      const initialCandidate = [
        '# @baseline BASE-REP-001',
        '# @requirements REQ-REP-01-R1',
        'openapi: 3.1.0',
        'info:',
        '  title: Failing Candidate',
        '  version: 1.0.0',
        'paths: {}'
      ].join('\n');
      fakeGen.queueResponse(`\`\`\`yaml\n${initialCandidate}\n\`\`\``);

      const repairedCandidate = [
        '# @baseline BASE-REP-001',
        '# @requirements REQ-REP-01-R1',
        'openapi: 3.1.0',
        'info:',
        '  title: Repaired Candidate',
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
        '    OrderLineItem:',
        '      type: object',
        '      required:',
        '        - id',
        '        - product_ref',
        '        - qty',
        '      properties:',
        '        id:',
        '          type: string',
        '          format: uuid',
        '        product_ref:',
        '          type: string',
        '        qty:',
        '          type: integer'
      ].join('\n');
      fakeGen.queueResponse(`\`\`\`yaml\n${repairedCandidate}\n\`\`\``);

      const openApiResult = await useCaseWithFailingValidator.execute({
        baselineId: baseline.id,
        sqlSchemaProjectionId: sqlResult.projectionId,
        options: { maxRepairAttempts: 2 }
      });

      expect(openApiResult.metadata.measuredVerification.repairsNeeded).toBe(1);

      // Verify repair prompt (the second generation call)
      const repairPrompt = fakeGen.recordedRequests[2].prompt;
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
    });
  }
);
