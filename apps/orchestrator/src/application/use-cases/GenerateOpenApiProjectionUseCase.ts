import { createHash, randomUUID } from 'node:crypto';
import {
  now,
  EmptyBaselineError,
  createRequirementsBaselineId,
  createRequirementRevisionId,
  createEngineeringDecisionId,
  createFindingId,
  createEngineeringDecision,
  createCandidateFinding,
  FINDING_TYPES,
  type RequirementsBaseline,
  type RequirementsBaselineId,
  type RequirementRevision,
  type PolicyConstraintRevision,
  type EngineeringDecision,
  type CandidateFinding,
  type FindingType
} from '@solutions-studio/domain';
import type { ProjectionMetadataDto } from '@solutions-studio/contracts';
import type { IGenerationGateway } from '../ports/generation/IGenerationGateway.js';
import type { IOpenApiValidatorGateway } from '../ports/validation/IOpenApiValidatorGateway.js';
import type {
  IRequirementsRepository,
  ProjectionRecord
} from '../ports/persistence/IRequirementsRepository.js';
import type { GenerateArtifactOptions, RepairAttemptRecord } from './GenerateArtifactUseCase.js';
import {
  UnknownRequirementRevisionError,
  UnknownRequirementsBaselineError,
  UnknownPolicyConstraintRevisionError,
  UnknownEngineeringDecisionError
} from './ReconciliationErrors.js';
import {
  UnknownProjectionError,
  ProjectionBaselineMismatchError,
  ProjectionArtifactTypeMismatchError,
  ConflictingSqlProjectionAuthorityError
} from './DiscoveryErrors.js';
import {
  OpenApiProvenanceValidationError,
  UnacceptedEngineeringDecisionError,
  RepairRetryExhaustionError
} from './OpenApiProjectionErrors.js';
import {
  SchemaApiCrossValidator,
  parseSqlTables,
  detectTableRelationships,
  type SqlTableDefinition,
  type SqlTableRelationship
} from './crossValidation/schemaApiCrossValidator.js';

export interface SqlSchemaContext {
  readonly projectionId: string;
  readonly tables: readonly SqlTableDefinition[];
  readonly relationships?: readonly SqlTableRelationship[];
  readonly decisions: readonly string[];
}

export interface OpenApiProjectionResult {
  readonly projectionId: string;
  readonly content: string;
  readonly metadata: ProjectionMetadataDto;
  readonly repairHistory: readonly RepairAttemptRecord[];
  readonly proposedEngineeringDecisions?: readonly EngineeringDecision[];
  readonly candidateFindings?: readonly CandidateFinding[];
}

export interface GenerateOpenApiProjectionInput {
  readonly baselineId: RequirementsBaselineId | string;
  readonly prompt?: string;
  readonly options?: GenerateArtifactOptions & { model?: string };
  readonly id?: string;
  readonly engineeringDecisionIds?: readonly string[];
  readonly sqlSchemaProjectionId?: string;
  readonly autoRecordDiscoveries?: boolean;
}

export interface DeclaredOpenApiProvenance {
  readonly baselineId?: string;
  readonly requirementRevisionIds: readonly string[];
  readonly policyConstraintRevisionIds?: readonly string[];
  readonly engineeringDecisionIds?: readonly string[];
}

export interface OpenApiProvenanceValidationResult {
  readonly isValid: boolean;
  readonly errorMessage?: string;
  readonly declaredProvenance?: DeclaredOpenApiProvenance;
}

export const NAMING_ALIGNMENT_INSTRUCTIONS = [
  'OpenAPI Entity, Schema, and Field Naming Alignment Requirements:',
  '- Entity and Schema Naming:',
  '  - Component schemas representing database entities MUST match the SQL table name (e.g. table "<entities>" -> schema "<Entity>"; child table "<entities>_<items>" -> schema "<Entity><Item>" or "<Entity><Items>").',
  '  - Do NOT independently invent divergent entity names (e.g. do NOT use unrelated synonyms when a backing table is defined in the relational schema).',
  '- Field and Property Naming Consistency:',
  '  - OpenAPI schema properties MUST use exact matching field names for corresponding SQL columns.',
  '  - Ground domain concepts directly in the SQL column names chosen: use exact column names from the SQL table definitions; do NOT rename columns to synonyms.',
  '  - Retain exact snake_case property naming matching the SQL columns.',
  '- Parent-Child Array Relationships:',
  '  - When an entity schema includes an array of child entities, the array items property MUST reference the matching child component schema (e.g. "$ref: \'#/components/schemas/<ChildEntity>\'").',
  '  - In creation/input requests (e.g. "<Entity>CreateRequest"), child items represent nested records to be created; their parent foreign key (e.g. "<parent>_id") is implicit from the relationship and should NOT be required in the client request body, but all other child entity fields MUST strictly match the child table columns.',
  '- Response Wrapper Schemas:',
  '  - For collection or list responses, use standard naming with a "Response" suffix (e.g. "<Entity>ListResponse") or return an array directly ("<Entity>[]"), rather than inventing standalone envelope schemas without a Response suffix.'
].join('\n');

export function formatRelationalTableContext(
  table: SqlTableDefinition,
  relationships: readonly SqlTableRelationship[] = []
): string {
  const pkColNames =
    table.primaryKeyColumns.length > 0 ? table.primaryKeyColumns.join(', ') : 'none';
  const pkTypes =
    table.primaryKeyColumns.length > 0
      ? table.primaryKeyColumns
          .map((colName) => {
            const col = table.columns.find((c) => c.name.toLowerCase() === colName.toLowerCase());
            return col ? col.type : 'UNKNOWN';
          })
          .join(', ')
      : 'UNKNOWN';

  const childRelations = relationships.filter((r) => r.childTable === table.name);
  const relationNotes = childRelations.map((r) =>
    r.isChildEntity
      ? `  - Role: Child/related entity of parent table '${r.parentTable}' (linked via '${r.foreignKeyColumn}' -> '${r.parentTable}.${r.referencedColumn ?? 'id'}')`
      : `  - Role: Related to table '${r.parentTable}' (linked via '${r.foreignKeyColumn}' -> '${r.parentTable}.${r.referencedColumn ?? 'id'}')`
  );

  const colLines = table.columns.map((col) => {
    const flags: string[] = [];
    if (col.isPrimaryKey) flags.push('PRIMARY KEY');
    if (col.isNotNull) flags.push('NOT NULL');
    if (col.hasDefault) flags.push('DEFAULT');
    if (col.referencesTable) {
      flags.push(`REFERENCES ${col.referencesTable}(${col.referencesColumn ?? 'id'})`);
    }
    if (col.checkValues && col.checkValues.length > 0) {
      flags.push(`CHECK IN (${col.checkValues.map((v) => `'${v}'`).join(', ')})`);
    }
    const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
    return `    - '${col.name}': ${col.type}${flagStr}`;
  });

  return [
    `- Table '${table.name}': Primary key column '${pkColNames}' (Type: ${pkTypes})`,
    ...relationNotes,
    '  - Columns:',
    ...(colLines.length > 0 ? colLines : ["    - 'none'"])
  ].join('\n');
}

export function formatRelationalSchemaContext(
  sqlContext: SqlSchemaContext,
  baselineId: string
): string {
  const tableSections = sqlContext.tables.map((t) =>
    formatRelationalTableContext(t, sqlContext.relationships ?? [])
  );

  const decisionLines =
    sqlContext.decisions.length > 0
      ? '\nRelational Engineering Decisions:\n' +
        sqlContext.decisions.map((d) => `- ${d}`).join('\n')
      : '';

  return (
    `\nRelational Schema Context (from SQL projection ${sqlContext.projectionId}):\n` +
    `The relational database schema for baseline ${baselineId} defines the following tables, columns, and relationships:\n` +
    (tableSections.length > 0 ? tableSections.join('\n\n') : '- No explicit tables defined') +
    decisionLines +
    '\n\nOpenAPI Identifier Alignment Requirements:\n' +
    '- Authority Precedence: Accepted Engineering Decisions take precedence over relational schema context if any ambiguity arises.\n' +
    '- All corresponding OpenAPI entity schemas and path parameters (e.g. {id}) MUST strictly match these primary key definitions:\n' +
    "  - If SQL primary key is UUID: OpenAPI schema property must be type 'string' with format 'uuid'.\n" +
    "  - If SQL primary key is integer/BIGINT/SERIAL: OpenAPI schema property must be type 'integer'.\n" +
    '- Do NOT introduce an identifier type that contradicts the relational schema.\n\n' +
    NAMING_ALIGNMENT_INSTRUCTIONS +
    '\n'
  );
}

export class GenerateOpenApiProjectionUseCase {
  private readonly defaultMaxRepairAttempts = 2;
  private readonly crossValidator = new SchemaApiCrossValidator();

  constructor(
    private readonly generationGateway: IGenerationGateway,
    private readonly validatorGateway: IOpenApiValidatorGateway,
    private readonly repository: IRequirementsRepository,
    private readonly providerName: string = 'fake'
  ) {}

  async execute(input: GenerateOpenApiProjectionInput): Promise<OpenApiProjectionResult> {
    const baselineId = createRequirementsBaselineId(input.baselineId);
    const baseline = await this.repository.getRequirementsBaseline(baselineId);
    if (!baseline) {
      throw new UnknownRequirementsBaselineError(input.baselineId);
    }

    if (!baseline.requirementRevisions || baseline.requirementRevisions.length === 0) {
      throw new EmptyBaselineError();
    }

    // 1. Load exact RequirementRevision records
    const revisions: RequirementRevision[] = [];
    for (const revId of baseline.requirementRevisions) {
      const rev = await this.repository.getRequirementRevision(revId);
      if (!rev) {
        throw new UnknownRequirementRevisionError(revId);
      }
      revisions.push(rev);
    }

    // 2. Load exact PolicyConstraintRevision records
    const policyConstraints: PolicyConstraintRevision[] = [];
    for (const polRevId of baseline.policyConstraintRevisions ?? []) {
      const pol = await this.repository.getPolicyConstraintRevision(polRevId);
      if (!pol) {
        throw new UnknownPolicyConstraintRevisionError(polRevId);
      }
      policyConstraints.push(pol);
    }

    // 3. Authority Ingestion & Decision Invariant Enforcement
    const acceptedDecisions: EngineeringDecision[] = [];
    if (input.engineeringDecisionIds !== undefined) {
      // Explicit engineering decisions specified by caller: all must exist, belong to baseline, and be ACCEPTED
      for (const edIdStr of input.engineeringDecisionIds) {
        const edId = createEngineeringDecisionId(edIdStr);
        const decision = await this.repository.getEngineeringDecision(edId);
        if (!decision) {
          throw new UnknownEngineeringDecisionError(edIdStr);
        }
        if (decision.baselineId !== baseline.id) {
          throw new OpenApiProvenanceValidationError(
            `Engineering decision '${edIdStr}' does not belong to baseline '${baseline.id}'`,
            baseline.id
          );
        }
        if (decision.state !== 'ACCEPTED') {
          throw new UnacceptedEngineeringDecisionError(decision.id, decision.state, baseline.id);
        }
        acceptedDecisions.push(decision);
      }
    } else {
      // Omitted: automatically lookup all accepted decisions for the baseline
      const decisions = await this.repository.listEngineeringDecisions({
        baselineId: baseline.id,
        state: 'ACCEPTED'
      });
      acceptedDecisions.push(...decisions);
    }

    // 4. Resolve SQL schema projection context (if available) to ensure cross-projection consistency
    let sqlRecord: ProjectionRecord | undefined;
    if (input.sqlSchemaProjectionId) {
      sqlRecord = await this.repository.getProjectionRecord(input.sqlSchemaProjectionId);
      if (!sqlRecord) {
        throw new UnknownProjectionError(input.sqlSchemaProjectionId);
      }
      if (sqlRecord.baselineId !== baseline.id) {
        throw new ProjectionBaselineMismatchError(
          input.sqlSchemaProjectionId,
          sqlRecord.baselineId,
          baseline.id
        );
      }
      if (sqlRecord.artifactType !== 'sql-schema') {
        throw new ProjectionArtifactTypeMismatchError(
          input.sqlSchemaProjectionId,
          sqlRecord.artifactType,
          'sql-schema'
        );
      }
    } else {
      const projections = await this.repository.listProjectionRecords(baseline.id);
      const sqlProjections = projections
        .filter((p) => p.artifactType === 'sql-schema')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      if (sqlProjections.length > 0) {
        sqlRecord = sqlProjections[0];
      }
    }

    let sqlContext: SqlSchemaContext | undefined;
    if (sqlRecord && sqlRecord.content) {
      const tables = parseSqlTables(sqlRecord.content);
      const relationships = detectTableRelationships(tables);
      const decisionMatches = [
        ...sqlRecord.content.matchAll(/(?:--|\/\*)\s*@decision:\s*([^\r\n*]+)/gi)
      ];
      const decisions = decisionMatches.map((m) => m[1].trim()).filter((s) => s.length > 0);
      sqlContext = {
        projectionId: sqlRecord.id,
        tables,
        relationships,
        decisions
      };

      // Check for authority conflicts between accepted EngineeringDecisions and relational schema primary keys
      if (acceptedDecisions.length > 0 && sqlContext.tables.length > 0) {
        for (const decision of acceptedDecisions) {
          const isUuidDecision =
            /(?:primary\s+key|surrogate\s+key|id(?:entifier)?).*uuid|uuid.*(?:primary\s+key|surrogate\s+key|id(?:entifier)?)/i.test(
              decision.statement
            );
          const isBigIntDecision =
            /(?:primary\s+key|surrogate\s+key|id(?:entifier)?).*(?:bigint|identity|serial|integer)|(?:bigint|identity|serial|integer).*(?:primary\s+key|surrogate\s+key|id(?:entifier)?)/i.test(
              decision.statement
            );

          if (isUuidDecision || isBigIntDecision) {
            for (const table of sqlContext.tables) {
              for (const pkColName of table.primaryKeyColumns) {
                const col = table.columns.find((c) => c.name === pkColName);
                if (col) {
                  const upperType = col.type.toUpperCase();
                  const isSqlBigInt =
                    upperType.includes('BIGINT') ||
                    upperType.includes('INT') ||
                    upperType.includes('SERIAL') ||
                    upperType.includes('IDENTITY');
                  const isSqlUuid = upperType.includes('UUID');

                  if (isUuidDecision && isSqlBigInt) {
                    throw new ConflictingSqlProjectionAuthorityError(
                      sqlRecord.id,
                      decision.id,
                      `SQL schema projection '${sqlRecord.id}' primary key column '${pkColName}' has type '${col.type}', which conflicts with accepted EngineeringDecision '${decision.id}': '${decision.statement}'`
                    );
                  }
                  if (isBigIntDecision && isSqlUuid) {
                    throw new ConflictingSqlProjectionAuthorityError(
                      sqlRecord.id,
                      decision.id,
                      `SQL schema projection '${sqlRecord.id}' primary key column '${pkColName}' has type '${col.type}', which conflicts with accepted EngineeringDecision '${decision.id}': '${decision.statement}'`
                    );
                  }
                }
              }
            }
          }
        }
      }
    }

    // 5. Build prompt and generate initial candidate
    const prompt = this.buildInitialPrompt(
      baseline,
      revisions,
      policyConstraints,
      acceptedDecisions,
      input.prompt,
      sqlContext
    );
    const initialGeneration = await this.generationGateway.generate({ prompt });
    const initialCandidate = this.extractOpenApiContent(initialGeneration.text);

    // 6. Bounded closed-loop repair
    const repairResult = await this.validateAndRepair(
      initialCandidate,
      baseline,
      acceptedDecisions,
      input.options,
      sqlContext
    );

    const projectionId = input.id ?? `PROJ-${randomUUID()}`;

    // 7. Discovery Extraction & Lineage Population
    const autoRecord = input.autoRecordDiscoveries !== false;
    const { proposedDecisions, candidateFindings: discoveryFindings } =
      await this.extractAndRecordDiscoveries(
        repairResult.content,
        repairResult.parsedDocument,
        baseline,
        projectionId,
        autoRecord
      );

    // 8. Targeted Cross-Validation against SQL schema projection
    const crossValidationFindings = await this.executeCrossValidation(
      baseline,
      repairResult.parsedDocument,
      projectionId,
      input.sqlSchemaProjectionId,
      autoRecord,
      sqlRecord
    );

    const allCandidateFindings = [...discoveryFindings, ...crossValidationFindings];

    // 8. Calculate SHA-256 content hash and persist ProjectionRecord
    const contentHash = createHash('sha256').update(repairResult.content).digest('hex');

    const metadata: ProjectionMetadataDto = {
      baselineId: baseline.id,
      requirementRevisionIds: [...baseline.requirementRevisions],
      policyConstraintRevisionIds: baseline.policyConstraintRevisions
        ? [...baseline.policyConstraintRevisions]
        : undefined,
      engineeringDecisionIds:
        acceptedDecisions.length > 0 ? acceptedDecisions.map((d) => d.id) : undefined,
      artifactType: 'openapi',
      declaredProvenance: {
        baselineId: repairResult.declaredProvenance.baselineId!,
        requirementRevisionIds: [...repairResult.declaredProvenance.requirementRevisionIds],
        policyConstraintRevisionIds: repairResult.declaredProvenance.policyConstraintRevisionIds
          ? [...repairResult.declaredProvenance.policyConstraintRevisionIds]
          : undefined,
        engineeringDecisionIds: repairResult.declaredProvenance.engineeringDecisionIds
          ? [...repairResult.declaredProvenance.engineeringDecisionIds]
          : undefined
      },
      configuredExecution: {
        provider: this.providerName,
        model: input.options?.model,
        artifactType: 'openapi'
      },
      measuredVerification: {
        repairsNeeded: repairResult.repairsNeeded,
        attemptCount: repairResult.repairHistory.length + 1,
        contentHash,
        verifiedAt: now()
      }
    };

    const record: ProjectionRecord = {
      id: projectionId,
      baselineId: baseline.id,
      requirementRevisionIds: baseline.requirementRevisions,
      policyConstraintRevisionIds: baseline.policyConstraintRevisions,
      engineeringDecisionIds:
        acceptedDecisions.length > 0 ? acceptedDecisions.map((d) => d.id) : undefined,
      artifactType: 'openapi',
      content: repairResult.content,
      metadata,
      createdAt: now()
    };

    await this.repository.saveProjectionRecord(record);

    return {
      projectionId,
      content: repairResult.content,
      metadata,
      repairHistory: repairResult.repairHistory,
      proposedEngineeringDecisions: proposedDecisions,
      candidateFindings: allCandidateFindings.length > 0 ? allCandidateFindings : undefined
    };
  }

  /**
   * Validates declared provenance and structural integrity with bounded closed-loop repair.
   */
  async validateAndRepair(
    initialCandidate: string,
    baseline: RequirementsBaseline,
    acceptedDecisions: readonly EngineeringDecision[],
    options?: GenerateArtifactOptions,
    sqlContext?: SqlSchemaContext
  ): Promise<{
    content: string;
    repairsNeeded: number;
    repairHistory: RepairAttemptRecord[];
    declaredProvenance: DeclaredOpenApiProvenance;
    parsedDocument: Record<string, unknown>;
  }> {
    const maxAttempts = options?.maxRepairAttempts ?? this.defaultMaxRepairAttempts;
    let currentCandidate = this.extractOpenApiContent(initialCandidate);
    const repairHistory: RepairAttemptRecord[] = [];

    // Step 1: Initial candidate validation
    const initialValidation = await this.validateCandidate(
      currentCandidate,
      baseline,
      acceptedDecisions
    );
    if (initialValidation.isValid && initialValidation.declaredProvenance) {
      return {
        content: currentCandidate,
        repairsNeeded: 0,
        repairHistory: [],
        declaredProvenance: initialValidation.declaredProvenance,
        parsedDocument: initialValidation.parsedDocument ?? {}
      };
    }

    // Record failure and enter repair loop
    repairHistory.push({
      attempt: 0,
      candidate: currentCandidate,
      errorMessage: initialValidation.errorMessage ?? 'Unknown validation error'
    });

    let repairAttempts = 0;
    while (repairAttempts < maxAttempts) {
      repairAttempts++;
      const lastError = repairHistory[repairHistory.length - 1].errorMessage;
      const repairPrompt = this.buildRepairPrompt(
        currentCandidate,
        lastError,
        baseline,
        acceptedDecisions,
        sqlContext
      );

      const repairGeneration = await this.generationGateway.generate({
        prompt: repairPrompt
      });

      currentCandidate = this.extractOpenApiContent(repairGeneration.text);
      const validation = await this.validateCandidate(
        currentCandidate,
        baseline,
        acceptedDecisions
      );

      if (validation.isValid && validation.declaredProvenance) {
        return {
          content: currentCandidate,
          repairsNeeded: repairAttempts,
          repairHistory,
          declaredProvenance: validation.declaredProvenance,
          parsedDocument: validation.parsedDocument ?? {}
        };
      }

      repairHistory.push({
        attempt: repairAttempts,
        candidate: currentCandidate,
        errorMessage: validation.errorMessage ?? 'Unknown validation error'
      });
    }

    // Exhausted repair attempts: throw typed failure
    const errorMessages = repairHistory.map((h) => `Attempt ${h.attempt}: ${h.errorMessage}`);
    throw new RepairRetryExhaustionError(
      `OpenAPI contract repair failed after ${maxAttempts} attempt(s). Contract remains invalid.`,
      repairAttempts,
      currentCandidate,
      errorMessages
    );
  }

  /**
   * Validates a candidate OpenAPI string for provenance and structural correctness.
   */
  async validateCandidate(
    openApiCode: string,
    baseline: RequirementsBaseline,
    acceptedDecisions: readonly EngineeringDecision[]
  ): Promise<{
    isValid: boolean;
    errorMessage?: string;
    declaredProvenance?: DeclaredOpenApiProvenance;
    parsedDocument?: Record<string, unknown>;
  }> {
    // 1. Structural check
    const structResult = await this.validatorGateway.validate(openApiCode);
    if (!structResult.isValid) {
      return {
        isValid: false,
        errorMessage: structResult.errorMessage ?? 'OpenAPI structural validation failed.'
      };
    }

    // 2. Provenance check (supports top comments and x-* extensions in parsedDocument)
    const provResult = this.validateProvenance(
      openApiCode,
      baseline,
      acceptedDecisions,
      structResult.parsedDocument
    );
    if (!provResult.isValid) {
      return {
        isValid: false,
        errorMessage: provResult.errorMessage
      };
    }

    return {
      isValid: true,
      declaredProvenance: provResult.declaredProvenance,
      parsedDocument: structResult.parsedDocument ?? {}
    };
  }

  /**
   * Validates declared provenance against baseline membership and conditional invariants.
   */
  validateProvenance(
    code: string,
    baseline: RequirementsBaseline,
    acceptedDecisions: readonly EngineeringDecision[],
    parsedDocument?: Record<string, unknown>
  ): OpenApiProvenanceValidationResult {
    const extracted = this.extractDeclaredProvenance(code, parsedDocument);

    // 1. Mandatory @baseline
    if (!extracted.baselineId) {
      return {
        isValid: false,
        errorMessage: `Missing or malformed '# @baseline' declaration in OpenAPI header. Expected '# @baseline ${baseline.id}'.`
      };
    }

    if (extracted.baselineId !== baseline.id) {
      return {
        isValid: false,
        errorMessage: `Declared baseline ID '${extracted.baselineId}' does not match expected baseline '${baseline.id}'.`
      };
    }

    // 2. Mandatory @requirements
    if (extracted.requirementRevisionIds.length === 0) {
      return {
        isValid: false,
        errorMessage: `Missing or malformed '# @requirements' declaration in OpenAPI header. Expected revision IDs from baseline: [${baseline.requirementRevisions.join(', ')}].`
      };
    }

    const baselineRevSet = new Set<string>(baseline.requirementRevisions);
    const extraneousReqIds = extracted.requirementRevisionIds.filter(
      (id) => !baselineRevSet.has(id)
    );
    if (extraneousReqIds.length > 0) {
      return {
        isValid: false,
        errorMessage: `Declared requirement revision ID(s) [${extraneousReqIds.join(', ')}] are not members of baseline '${baseline.id}'. Allowed revisions: [${baseline.requirementRevisions.join(', ')}].`
      };
    }

    // 3. Conditionally mandatory @policy-constraints
    const hasPolicyConstraints =
      baseline.policyConstraintRevisions && baseline.policyConstraintRevisions.length > 0;

    if (hasPolicyConstraints) {
      if (
        !extracted.policyConstraintRevisionIds ||
        extracted.policyConstraintRevisionIds.length === 0
      ) {
        return {
          isValid: false,
          errorMessage: `Missing '# @policy-constraints' declaration in OpenAPI header for baseline with policy constraints. Expected: [${baseline.policyConstraintRevisions!.join(', ')}].`
        };
      }

      const baselinePolSet = new Set<string>(baseline.policyConstraintRevisions);
      const extraneousPolIds = extracted.policyConstraintRevisionIds.filter(
        (id) => !baselinePolSet.has(id)
      );
      if (extraneousPolIds.length > 0) {
        return {
          isValid: false,
          errorMessage: `Declared policy constraint revision ID(s) [${extraneousPolIds.join(', ')}] are not members of baseline '${baseline.id}'. Allowed policy constraints: [${baseline.policyConstraintRevisions!.join(', ')}].`
        };
      }
    } else {
      // Baseline has no policy constraints: header is optional, but if present cannot declare extraneous IDs
      if (
        extracted.policyConstraintRevisionIds &&
        extracted.policyConstraintRevisionIds.length > 0
      ) {
        return {
          isValid: false,
          errorMessage: `Declared policy constraint revision ID(s) [${extracted.policyConstraintRevisionIds.join(', ')}] are not members of baseline '${baseline.id}' (baseline has no policy constraints).`
        };
      }
    }

    // 4. Optional @engineering-decisions
    if (extracted.engineeringDecisionIds && extracted.engineeringDecisionIds.length > 0) {
      const acceptedDecisionIdSet = new Set(acceptedDecisions.map((d) => d.id as string));
      const extraneousEdIds = extracted.engineeringDecisionIds.filter(
        (id) => !acceptedDecisionIdSet.has(id)
      );
      if (extraneousEdIds.length > 0) {
        return {
          isValid: false,
          errorMessage: `Declared engineering decision ID(s) [${extraneousEdIds.join(', ')}] are not accepted decisions for baseline '${baseline.id}'. Allowed decisions: [${[...acceptedDecisionIdSet].join(', ')}].`
        };
      }
    }

    return {
      isValid: true,
      declaredProvenance: extracted
    };
  }

  /**
   * Extracts declared baseline, requirement revisions, policy constraints, and decisions
   * from top-of-file comments AND/OR OpenAPI specification extensions under info/root.
   */
  extractDeclaredProvenance(
    code: string,
    parsedDocument?: Record<string, unknown>
  ): DeclaredOpenApiProvenance {
    // 1. Comments extraction
    const baselineMatch = code.match(/(?:#|\/\/|\/\*)\s*@baseline\s*[:\s]\s*([A-Za-z0-9_-]+)/i);
    let baselineId = baselineMatch ? baselineMatch[1] : undefined;

    const reqMatches = [
      ...code.matchAll(/(?:#|\/\/|\/\*)\s*@(?:requirements|implements)\s*[:\s]\s*([^\r\n*]+)/gi)
    ];
    const rawReqIds: string[] = [];
    for (const match of reqMatches) {
      const parts = match[1]
        .split(/[\s,]+/)
        .map((s) => s.trim().replace(/^\[|\]$/g, ''))
        .filter((s) => s.length > 0);
      rawReqIds.push(...parts);
    }

    const polMatches = [
      ...code.matchAll(/(?:#|\/\/|\/\*)\s*@policy-constraints?\s*[:\s]\s*([^\r\n*]+)/gi)
    ];
    const rawPolIds: string[] = [];
    for (const match of polMatches) {
      const parts = match[1]
        .split(/[\s,]+/)
        .map((s) => s.trim().replace(/^\[|\]$/g, ''))
        .filter((s) => s.length > 0);
      rawPolIds.push(...parts);
    }

    const edMatches = [
      ...code.matchAll(/(?:#|\/\/|\/\*)\s*@engineering-decisions?\s*[:\s]\s*([^\r\n*]+)/gi)
    ];
    const rawEdIds: string[] = [];
    for (const match of edMatches) {
      const parts = match[1]
        .split(/[\s,]+/)
        .map((s) => s.trim().replace(/^\[|\]$/g, ''))
        .filter((s) => s.length > 0);
      rawEdIds.push(...parts);
    }

    // 2. Extensions (x-*) extraction
    if (parsedDocument) {
      const info = (parsedDocument.info as Record<string, unknown> | undefined) ?? {};
      if (!baselineId) {
        const extBase = parsedDocument['x-baseline'] ?? info['x-baseline'];
        if (typeof extBase === 'string') baselineId = extBase;
      }
      const extReqs = parsedDocument['x-requirements'] ?? info['x-requirements'];
      if (extReqs) {
        if (Array.isArray(extReqs)) {
          rawReqIds.push(...extReqs.map(String));
        } else if (typeof extReqs === 'string') {
          rawReqIds.push(...extReqs.split(/[\s,]+/).filter(Boolean));
        }
      }
      const extPols = parsedDocument['x-policy-constraints'] ?? info['x-policy-constraints'];
      if (extPols) {
        if (Array.isArray(extPols)) {
          rawPolIds.push(...extPols.map(String));
        } else if (typeof extPols === 'string') {
          rawPolIds.push(...extPols.split(/[\s,]+/).filter(Boolean));
        }
      }
      const extEds = parsedDocument['x-engineering-decisions'] ?? info['x-engineering-decisions'];
      if (extEds) {
        if (Array.isArray(extEds)) {
          rawEdIds.push(...extEds.map(String));
        } else if (typeof extEds === 'string') {
          rawEdIds.push(...extEds.split(/[\s,]+/).filter(Boolean));
        }
      }
    }

    return {
      baselineId,
      requirementRevisionIds: [...new Set(rawReqIds)],
      policyConstraintRevisionIds: rawPolIds.length > 0 ? [...new Set(rawPolIds)] : undefined,
      engineeringDecisionIds: rawEdIds.length > 0 ? [...new Set(rawEdIds)] : undefined
    };
  }

  /**
   * Extracts and records discoveries (proposed engineering decisions and candidate findings).
   */
  async extractAndRecordDiscoveries(
    code: string,
    parsedDoc: Record<string, unknown> | undefined,
    baseline: RequirementsBaseline,
    projectionId: string,
    autoRecord: boolean
  ): Promise<{
    proposedDecisions: EngineeringDecision[];
    candidateFindings: CandidateFinding[];
  }> {
    const proposedDecisions: EngineeringDecision[] = [];
    const candidateFindings: CandidateFinding[] = [];

    // 1. Decisions from comments: # @decision: <statement> | <rationale>
    const decisionMatches = [
      ...code.matchAll(/(?:#|\/\/|\/\*)\s*@decision:\s*([^|\r\n*]+)\s*\|\s*([^\r\n*]+)/gi)
    ];
    for (const match of decisionMatches) {
      const statement = match[1].trim();
      const rationale = match[2].trim();
      if (!statement || !rationale) continue;

      const decisionId = createEngineeringDecisionId(`ED-${randomUUID()}`);
      const decision = createEngineeringDecision({
        id: decisionId,
        baselineId: baseline.id,
        statement,
        rationale,
        requirementRevisionIds: [...baseline.requirementRevisions],
        policyConstraintRevisionIds: baseline.policyConstraintRevisions
          ? [...baseline.policyConstraintRevisions]
          : [],
        state: 'PROPOSED',
        createdBy: 'openapi-generator'
      });

      if (autoRecord) {
        await this.repository.saveEngineeringDecision(decision);
      }
      proposedDecisions.push(decision);
    }

    // Decisions from extensions: info.x-decisions
    const info = (parsedDoc?.info as Record<string, unknown> | undefined) ?? {};
    const extDecisions = parsedDoc?.['x-decisions'] ?? info['x-decisions'];
    if (Array.isArray(extDecisions)) {
      for (const item of extDecisions) {
        if (item && typeof item === 'object') {
          const dObj = item as Record<string, unknown>;
          const statement = String(dObj.statement ?? '').trim();
          const rationale = String(dObj.rationale ?? '').trim();
          if (!statement || !rationale) continue;

          // Check if already captured from comment
          if (proposedDecisions.some((d) => d.statement === statement)) continue;

          const decisionId = createEngineeringDecisionId(`ED-${randomUUID()}`);
          const decision = createEngineeringDecision({
            id: decisionId,
            baselineId: baseline.id,
            statement,
            rationale,
            requirementRevisionIds: [...baseline.requirementRevisions],
            policyConstraintRevisionIds: baseline.policyConstraintRevisions
              ? [...baseline.policyConstraintRevisions]
              : [],
            state: 'PROPOSED',
            createdBy: 'openapi-generator'
          });

          if (autoRecord) {
            await this.repository.saveEngineeringDecision(decision);
          }
          proposedDecisions.push(decision);
        }
      }
    }

    // 2. Findings from comments: # @finding: <type> | <rationale> [| <revIds>]
    const findingMatches = [
      ...code.matchAll(
        /(?:#|\/\/|\/\*)\s*@finding:\s*([^|\r\n*]+)\s*\|\s*([^|\r\n*]+?)(?:\s*\|\s*([^\r\n*]+))?(?:\*\/|$)/gim
      )
    ];
    for (const match of findingMatches) {
      const rawType = match[1].trim();
      const rationale = match[2].trim();
      const rawRevIds = match[3]?.trim();
      if (!rawType || !rationale) continue;

      const findingType: FindingType = (FINDING_TYPES as readonly string[]).includes(rawType)
        ? (rawType as FindingType)
        : 'unsupported-assumption';

      let affectedRevs = [...baseline.requirementRevisions];
      if (rawRevIds && rawRevIds.length > 0) {
        const parsedIds = rawRevIds
          .split(/[\s,]+/)
          .map((s) => s.trim().replace(/^\[|\]$/g, ''))
          .filter((s) => s.length > 0);
        const baselineRevSet = new Set(baseline.requirementRevisions.map((id) => id as string));
        const matched = parsedIds.filter((id) => baselineRevSet.has(id));
        if (matched.length > 0) {
          affectedRevs = matched.map((id) => createRequirementRevisionId(id));
        }
      }

      const findingId = createFindingId(`FINDING-${randomUUID()}`);
      const finding = createCandidateFinding({
        id: findingId,
        type: findingType,
        affectedRequirementRevisions: affectedRevs,
        evidence: [],
        discoveredBy: 'artifact-validation',
        disposition: 'OPEN',
        rationale,
        baselineId: baseline.id,
        originatingProjectionId: projectionId
      });

      if (autoRecord) {
        await this.repository.saveCandidateFinding(finding);
      }
      candidateFindings.push(finding);
    }

    // Findings from extensions: info.x-findings
    const extFindings = parsedDoc?.['x-findings'] ?? info['x-findings'];
    if (Array.isArray(extFindings)) {
      for (const item of extFindings) {
        if (item && typeof item === 'object') {
          const fObj = item as Record<string, unknown>;
          const rawType = String(fObj.type ?? '').trim();
          const rationale = String(fObj.rationale ?? '').trim();
          if (!rawType || !rationale) continue;

          if (candidateFindings.some((f) => f.rationale === rationale)) continue;

          const findingType: FindingType = (FINDING_TYPES as readonly string[]).includes(rawType)
            ? (rawType as FindingType)
            : 'unsupported-assumption';

          const findingId = createFindingId(`FINDING-${randomUUID()}`);
          const finding = createCandidateFinding({
            id: findingId,
            type: findingType,
            affectedRequirementRevisions: [...baseline.requirementRevisions],
            evidence: [],
            discoveredBy: 'artifact-validation',
            disposition: 'OPEN',
            rationale,
            baselineId: baseline.id,
            originatingProjectionId: projectionId
          });

          if (autoRecord) {
            await this.repository.saveCandidateFinding(finding);
          }
          candidateFindings.push(finding);
        }
      }
    }

    return { proposedDecisions, candidateFindings };
  }

  /**
   * Executes deterministic cross-validation against relational schema projection if available.
   */
  private async executeCrossValidation(
    baseline: RequirementsBaseline,
    openApiDoc: Record<string, unknown>,
    openApiProjectionId: string,
    explicitSqlProjectionId?: string,
    autoRecord?: boolean,
    resolvedSqlRecord?: ProjectionRecord
  ): Promise<CandidateFinding[]> {
    let sqlRecord: ProjectionRecord | undefined = resolvedSqlRecord;

    if (!sqlRecord) {
      if (explicitSqlProjectionId) {
        sqlRecord = await this.repository.getProjectionRecord(explicitSqlProjectionId);
      } else {
        const projections = await this.repository.listProjectionRecords(baseline.id);
        const sqlProjections = projections.filter((p) => p.artifactType === 'sql-schema');
        if (sqlProjections.length > 0) {
          sqlRecord = sqlProjections[sqlProjections.length - 1];
        }
      }
    }

    if (!sqlRecord || !sqlRecord.content) {
      return [];
    }

    const findings = this.crossValidator.validate({
      openApiDoc,
      sqlSchemaContent: sqlRecord.content,
      baseline,
      openApiProjectionId,
      sqlSchemaProjectionId: sqlRecord.id
    });

    if (autoRecord !== false) {
      for (const finding of findings) {
        await this.repository.saveCandidateFinding(finding);
      }
    }

    return findings;
  }

  private extractOpenApiContent(text: string): string {
    const trimmed = text.trim();
    const yamlMatch = trimmed.match(/```(?:yaml|yml)?\r?\n([\s\S]*?)\r?\n```/i);
    if (yamlMatch) {
      return yamlMatch[1].trim();
    }
    const jsonMatch = trimmed.match(/```json\r?\n([\s\S]*?)\r?\n```/i);
    if (jsonMatch) {
      return jsonMatch[1].trim();
    }
    return trimmed;
  }

  private buildInitialPrompt(
    baseline: RequirementsBaseline,
    revisions: readonly RequirementRevision[],
    policyConstraints: readonly PolicyConstraintRevision[],
    acceptedDecisions: readonly EngineeringDecision[],
    customPrompt?: string,
    sqlContext?: SqlSchemaContext
  ): string {
    const reqStatements = revisions
      .map((r) => `- [${r.id}] (${r.category}) ${r.statement}`)
      .join('\n');

    const polStatements =
      policyConstraints.length > 0
        ? '\nApplicable Policy Constraints:\n' +
          policyConstraints
            .map((p) => `- [${p.id}] ${p.statement} (Authority: ${p.authorityReference})`)
            .join('\n')
        : '';

    const edStatements =
      acceptedDecisions.length > 0
        ? '\nAccepted Engineering Decisions:\n' +
          acceptedDecisions
            .map((d) => `- [${d.id}] ${d.statement} (Rationale: ${d.rationale})`)
            .join('\n')
        : '';

    let relationalContextSection = '';
    if (sqlContext && sqlContext.tables.length > 0) {
      relationalContextSection = formatRelationalSchemaContext(sqlContext, baseline.id);
    } else {
      relationalContextSection =
        '\nPrimary Key & Identifier Format Convention:\n' +
        "- In the absence of an accepted engineering decision or relational schema context specifying an alternative, use UUID format ('id: { type: string, format: uuid }') as the standard primary key format.\n";
    }

    const polHeaderRequirement =
      policyConstraints.length > 0
        ? `   # @policy-constraints ${policyConstraints.map((p) => p.id).join(', ')}\n`
        : '';

    const edHeaderRequirement =
      acceptedDecisions.length > 0
        ? `   # @engineering-decisions ${acceptedDecisions.map((d) => d.id).join(', ')}\n`
        : '';

    const requirementsList: string[] = [
      '1. MUST declare openapi: 3.1.0 and root info with title and version.',
      '2. MUST begin with exact comment provenance headers (or info.x-* extensions):',
      `   # @baseline ${baseline.id}`,
      `   # @requirements ${baseline.requirementRevisions.join(', ')}`
    ];
    if (polHeaderRequirement) {
      requirementsList.push(polHeaderRequirement.trimEnd());
    }
    if (edHeaderRequirement) {
      requirementsList.push(edHeaderRequirement.trimEnd());
    }

    let stepNum = 3;
    if (acceptedDecisions.length > 0) {
      requirementsList.push(
        `${stepNum++}. MUST strictly comply with and implement all Accepted Engineering Decisions above (including primary key types and surrogate key strategies).`
      );
    }
    if (sqlContext && sqlContext.tables.length > 0) {
      requirementsList.push(
        `${stepNum++}. MUST strictly align component schema and property names with the relational tables and columns provided in the Relational Schema Context above.`
      );
    }
    requirementsList.push(
      `${stepNum++}. Paths, operations, parameters, request bodies, and responses must reflect authority requirements.`,
      `${stepNum++}. Every operation MUST declare a non-empty responses object.`,
      `${stepNum++}. Path template parameters (e.g. {id}) must have matching parameter definitions with in: path and required: true.`,
      `${stepNum++}. All $ref pointers must be resolvable within the document.`,
      `${stepNum++}. Decision Boundary Rules:\n` +
        '   - If making a legitimate technical choice (e.g. pagination mechanics, problem details envelope, caching headers), output:\n' +
        '     # @decision: <Statement> | <Rationale>\n' +
        '   - If encountering missing product behavior or policy ambiguity (e.g. unstated authorization scopes, undefined cardinality, missing failure recovery), DO NOT guess or invent requirements. Output:\n' +
        '     # @finding: <FindingType> | <Rationale> [| <RequirementRevisionIds>]',
      `${stepNum++}. Return ONLY the OpenAPI specification enclosed in a \`\`\`yaml or \`\`\`json markdown block without conversational filler.`
    );

    return [
      `Generate an OpenAPI 3.1 contract specification (YAML or JSON) for requirements baseline ${baseline.id}:`,
      reqStatements,
      polStatements,
      edStatements,
      relationalContextSection,
      customPrompt ? `\nAdditional reviewer instructions:\n${customPrompt}\n` : '',
      'Requirements for generated OpenAPI 3.1 contract:',
      ...requirementsList
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  private buildRepairPrompt(
    currentCandidate: string,
    errorMessage: string,
    baseline: RequirementsBaseline,
    acceptedDecisions: readonly EngineeringDecision[],
    sqlContext?: SqlSchemaContext
  ): string {
    const polHeader =
      baseline.policyConstraintRevisions && baseline.policyConstraintRevisions.length > 0
        ? `\n# @policy-constraints ${baseline.policyConstraintRevisions.join(', ')}`
        : '';

    const edHeader =
      acceptedDecisions.length > 0
        ? `\n# @engineering-decisions ${acceptedDecisions.map((d) => d.id).join(', ')}`
        : '';

    let alignmentSection = '';
    if (sqlContext && sqlContext.tables.length > 0) {
      const tableSections = sqlContext.tables.map((t) =>
        formatRelationalTableContext(t, sqlContext.relationships ?? [])
      );

      alignmentSection = [
        'OpenAPI Identifier Alignment Requirements (MUST strictly match relational primary keys):',
        '- Authority Precedence: Accepted Engineering Decisions take precedence over relational schema context if any ambiguity arises.',
        ...(tableSections.length > 0 ? tableSections : ['- No explicit tables defined']),
        "- If SQL primary key is UUID: OpenAPI schema property must be type 'string' with format 'uuid'.",
        "- If SQL primary key is integer/BIGINT/SERIAL: OpenAPI schema property must be type 'integer'.",
        '- Do NOT introduce an identifier type that contradicts the relational schema.',
        '',
        NAMING_ALIGNMENT_INSTRUCTIONS
      ].join('\n');
    }

    return [
      'The following OpenAPI 3.1 contract failed validation:',
      `${errorMessage}`,
      '',
      ...(alignmentSection ? [alignmentSection, ''] : []),
      'Correct the OpenAPI contract to fix the error.',
      'Ensure the contract begins with the required provenance comment headers (or info.x-* extensions):',
      `# @baseline ${baseline.id}`,
      `# @requirements ${baseline.requirementRevisions.join(', ')}${polHeader}${edHeader}`,
      '',
      'Return ONLY the corrected OpenAPI 3.1 contract enclosed in ```yaml or ```json without commentary:',
      '',
      currentCandidate
    ].join('\n');
  }
}
