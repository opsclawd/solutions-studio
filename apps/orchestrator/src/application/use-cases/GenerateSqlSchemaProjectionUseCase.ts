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
import type { ISqlValidatorGateway } from '../ports/validation/ISqlValidatorGateway.js';
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
  SqlProvenanceValidationError,
  UnacceptedEngineeringDecisionError,
  RepairRetryExhaustionError
} from './SqlSchemaProjectionErrors.js';

export interface SqlSchemaProjectionResult {
  readonly projectionId: string;
  readonly content: string;
  readonly metadata: ProjectionMetadataDto;
  readonly repairHistory: readonly RepairAttemptRecord[];
  readonly proposedEngineeringDecisions?: readonly EngineeringDecision[];
  readonly candidateFindings?: readonly CandidateFinding[];
}

export interface GenerateSqlSchemaProjectionInput {
  readonly baselineId: RequirementsBaselineId | string;
  readonly prompt?: string;
  readonly options?: GenerateArtifactOptions & { model?: string };
  readonly id?: string;
  readonly engineeringDecisionIds?: readonly string[];
  readonly autoRecordDiscoveries?: boolean;
}

export interface DeclaredSqlProvenance {
  readonly baselineId: string;
  readonly requirementRevisionIds: readonly string[];
  readonly policyConstraintRevisionIds?: readonly string[];
  readonly engineeringDecisionIds?: readonly string[];
}

export interface SqlProvenanceValidationResult {
  readonly isValid: boolean;
  readonly errorMessage?: string;
  readonly declaredProvenance?: DeclaredSqlProvenance;
}

export class GenerateSqlSchemaProjectionUseCase {
  private readonly defaultMaxRepairAttempts = 2;

  constructor(
    private readonly generationGateway: IGenerationGateway,
    private readonly validatorGateway: ISqlValidatorGateway,
    private readonly repository: IRequirementsRepository,
    private readonly providerName: string = 'fake'
  ) {}

  async execute(input: GenerateSqlSchemaProjectionInput): Promise<SqlSchemaProjectionResult> {
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
          throw new SqlProvenanceValidationError(
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

    // 4. Build prompt and generate initial candidate
    const prompt = this.buildInitialPrompt(
      baseline,
      revisions,
      policyConstraints,
      acceptedDecisions,
      input.prompt
    );
    const initialGeneration = await this.generationGateway.generate({ prompt });
    const initialCandidate = this.extractSqlContent(initialGeneration.text);

    // 5. Bounded closed-loop repair
    const repairResult = await this.validateAndRepair(
      initialCandidate,
      baseline,
      acceptedDecisions,
      input.options
    );

    const projectionId = input.id ?? `PROJ-${randomUUID()}`;

    // 6. Discovery Extraction & Lineage Population
    const autoRecord = input.autoRecordDiscoveries !== false;
    const { proposedDecisions, candidateFindings } = await this.extractAndRecordDiscoveries(
      repairResult.content,
      baseline,
      projectionId,
      autoRecord
    );

    // 7. Calculate SHA-256 content hash and persist ProjectionRecord
    const contentHash = createHash('sha256').update(repairResult.content).digest('hex');

    const metadata: ProjectionMetadataDto = {
      baselineId: baseline.id,
      requirementRevisionIds: [...baseline.requirementRevisions],
      policyConstraintRevisionIds: baseline.policyConstraintRevisions
        ? [...baseline.policyConstraintRevisions]
        : undefined,
      engineeringDecisionIds:
        acceptedDecisions.length > 0 ? acceptedDecisions.map((d) => d.id) : undefined,
      artifactType: 'sql-schema',
      declaredProvenance: {
        baselineId: repairResult.declaredProvenance.baselineId,
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
        artifactType: 'sql-schema'
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
      artifactType: 'sql-schema',
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
      candidateFindings
    };
  }

  /**
   * Validates declared provenance and executes against isolated SQL runtime with bounded closed-loop repair.
   */
  async validateAndRepair(
    initialCandidate: string,
    baseline: RequirementsBaseline,
    acceptedDecisions: readonly EngineeringDecision[],
    options?: GenerateArtifactOptions
  ): Promise<{
    content: string;
    repairsNeeded: number;
    repairHistory: RepairAttemptRecord[];
    declaredProvenance: DeclaredSqlProvenance;
  }> {
    const maxAttempts = options?.maxRepairAttempts ?? this.defaultMaxRepairAttempts;
    let currentCandidate = this.extractSqlContent(initialCandidate);
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
        declaredProvenance: initialValidation.declaredProvenance
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
        acceptedDecisions
      );

      const repairGeneration = await this.generationGateway.generate({
        prompt: repairPrompt
      });

      currentCandidate = this.extractSqlContent(repairGeneration.text);
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
          declaredProvenance: validation.declaredProvenance
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
      `SQL schema repair failed after ${maxAttempts} attempt(s). PostgreSQL DDL remains invalid.`,
      repairAttempts,
      currentCandidate,
      errorMessages
    );
  }

  /**
   * Validates a candidate SQL string for provenance headers and executes against isolated SQL runtime.
   */
  async validateCandidate(
    sqlCode: string,
    baseline: RequirementsBaseline,
    acceptedDecisions: readonly EngineeringDecision[]
  ): Promise<{
    isValid: boolean;
    errorMessage?: string;
    declaredProvenance?: DeclaredSqlProvenance;
  }> {
    // 1. Provenance check
    const provResult = this.validateProvenance(sqlCode, baseline, acceptedDecisions);
    if (!provResult.isValid) {
      return {
        isValid: false,
        errorMessage: provResult.errorMessage
      };
    }

    // 2. Execution check in isolated SQL runtime
    const sqlResult = await this.validatorGateway.validate(sqlCode);
    if (!sqlResult.isValid) {
      return {
        isValid: false,
        errorMessage:
          sqlResult.errorMessage ?? 'PostgreSQL DDL execution failed in isolated runtime.'
      };
    }

    return {
      isValid: true,
      declaredProvenance: provResult.declaredProvenance
    };
  }

  /**
   * Deterministically validates declared headers against baseline membership and conditional invariants.
   */
  validateProvenance(
    code: string,
    baseline: RequirementsBaseline,
    acceptedDecisions: readonly EngineeringDecision[]
  ): SqlProvenanceValidationResult {
    const extracted = this.extractDeclaredProvenance(code);

    // 1. Mandatory -- @baseline
    if (!extracted.baselineId) {
      return {
        isValid: false,
        errorMessage: `Missing or malformed '-- @baseline' declaration in SQL header. Expected '-- @baseline ${baseline.id}'.`
      };
    }

    if (extracted.baselineId !== baseline.id) {
      return {
        isValid: false,
        errorMessage: `Declared baseline ID '${extracted.baselineId}' does not match expected baseline '${baseline.id}'.`
      };
    }

    // 2. Mandatory -- @requirements
    if (extracted.requirementRevisionIds.length === 0) {
      return {
        isValid: false,
        errorMessage: `Missing or malformed '-- @requirements' declaration in SQL header. Expected revision IDs from baseline: [${baseline.requirementRevisions.join(', ')}].`
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

    // 3. Conditionally mandatory -- @policy-constraints
    const hasPolicyConstraints =
      baseline.policyConstraintRevisions && baseline.policyConstraintRevisions.length > 0;

    if (hasPolicyConstraints) {
      if (
        !extracted.policyConstraintRevisionIds ||
        extracted.policyConstraintRevisionIds.length === 0
      ) {
        return {
          isValid: false,
          errorMessage: `Missing '-- @policy-constraints' declaration in SQL header for baseline with policy constraints. Expected: [${baseline.policyConstraintRevisions!.join(', ')}].`
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

    // 4. Optional -- @engineering-decisions
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
      declaredProvenance: {
        baselineId: extracted.baselineId,
        requirementRevisionIds: extracted.requirementRevisionIds,
        policyConstraintRevisionIds: extracted.policyConstraintRevisionIds,
        engineeringDecisionIds: extracted.engineeringDecisionIds
      }
    };
  }

  /**
   * Asserts valid provenance or throws SqlProvenanceValidationError.
   */
  assertValidProvenance(
    code: string,
    baseline: RequirementsBaseline,
    acceptedDecisions: readonly EngineeringDecision[]
  ): DeclaredSqlProvenance {
    const result = this.validateProvenance(code, baseline, acceptedDecisions);
    if (!result.isValid || !result.declaredProvenance) {
      throw new SqlProvenanceValidationError(
        result.errorMessage ?? 'Invalid SQL provenance',
        baseline.id,
        undefined,
        baseline.requirementRevisions,
        undefined,
        baseline.policyConstraintRevisions
      );
    }
    return result.declaredProvenance;
  }

  /**
   * Extracts declared baseline, requirement revisions, policy constraints, and decisions from SQL comments.
   */
  extractDeclaredProvenance(code: string): {
    baselineId?: string;
    requirementRevisionIds: string[];
    policyConstraintRevisionIds?: string[];
    engineeringDecisionIds?: string[];
  } {
    const baselineMatch = code.match(/(?:--|\/\*)\s*@baseline\s*[:\s]\s*([A-Za-z0-9_-]+)/i);
    const baselineId = baselineMatch ? baselineMatch[1] : undefined;

    // Requirement revisions
    const reqMatches = [
      ...code.matchAll(/(?:--|\/\*)\s*@(?:requirements|implements)\s*[:\s]\s*([^\r\n*]+)/gi)
    ];
    const rawReqIds: string[] = [];
    for (const match of reqMatches) {
      const parts = match[1]
        .split(/[\s,]+/)
        .map((s) => s.trim().replace(/^\[|\]$/g, ''))
        .filter((s) => s.length > 0);
      rawReqIds.push(...parts);
    }
    const requirementRevisionIds = [...new Set(rawReqIds)];

    // Policy constraints
    const polMatches = [
      ...code.matchAll(/(?:--|\/\*)\s*@policy-constraints?\s*[:\s]\s*([^\r\n*]+)/gi)
    ];
    let policyConstraintRevisionIds: string[] | undefined = undefined;
    if (polMatches.length > 0) {
      const rawPolIds: string[] = [];
      for (const match of polMatches) {
        const parts = match[1]
          .split(/[\s,]+/)
          .map((s) => s.trim().replace(/^\[|\]$/g, ''))
          .filter((s) => s.length > 0);
        rawPolIds.push(...parts);
      }
      policyConstraintRevisionIds = [...new Set(rawPolIds)];
    }

    // Engineering decisions
    const edMatches = [
      ...code.matchAll(/(?:--|\/\*)\s*@engineering-decisions?\s*[:\s]\s*([^\r\n*]+)/gi)
    ];
    let engineeringDecisionIds: string[] | undefined = undefined;
    if (edMatches.length > 0) {
      const rawEdIds: string[] = [];
      for (const match of edMatches) {
        const parts = match[1]
          .split(/[\s,]+/)
          .map((s) => s.trim().replace(/^\[|\]$/g, ''))
          .filter((s) => s.length > 0);
        rawEdIds.push(...parts);
      }
      engineeringDecisionIds = [...new Set(rawEdIds)];
    }

    return {
      baselineId,
      requirementRevisionIds,
      policyConstraintRevisionIds,
      engineeringDecisionIds
    };
  }

  /**
   * Extracts and records discoveries (proposed engineering decisions and candidate findings).
   * Populates affectedRequirementRevisions defaulting to all baseline requirements to guarantee lineage blocking.
   */
  async extractAndRecordDiscoveries(
    sqlCode: string,
    baseline: RequirementsBaseline,
    projectionId: string,
    autoRecord: boolean
  ): Promise<{
    proposedDecisions: EngineeringDecision[];
    candidateFindings: CandidateFinding[];
  }> {
    const proposedDecisions: EngineeringDecision[] = [];
    const candidateFindings: CandidateFinding[] = [];

    // 1. Parse -- @decision: <statement> | <rationale>
    const decisionMatches = [
      ...sqlCode.matchAll(/(?:--|\/\*)\s*@decision:\s*([^|\r\n*]+)\s*\|\s*([^\r\n*]+)/gi)
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
        createdBy: 'sql-schema-generator'
      });

      if (autoRecord) {
        await this.repository.saveEngineeringDecision(decision);
      }
      proposedDecisions.push(decision);
    }

    // 2. Parse -- @finding: <type> | <rationale> [| <revIds>]
    const findingMatches = [
      ...sqlCode.matchAll(
        /(?:--|\/\*)\s*@finding:\s*([^|\r\n*]+)\s*\|\s*([^|\r\n*]+?)(?:\s*\|\s*([^\r\n*]+))?(?:\*\/|$)/gim
      )
    ];
    for (const match of findingMatches) {
      const rawType = match[1].trim();
      const rationale = match[2].trim();
      const rawRevIds = match[3]?.trim();
      if (!rawType || !rationale) continue;

      // Determine valid FindingType
      const findingType: FindingType = (FINDING_TYPES as readonly string[]).includes(rawType)
        ? (rawType as FindingType)
        : 'unsupported-assumption';

      // Finding 1: Populate affectedRequirementRevisions, defaulting to all baseline requirements
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

    return { proposedDecisions, candidateFindings };
  }

  private extractSqlContent(text: string): string {
    const trimmed = text.trim();
    const fenceMatch = trimmed.match(/```(?:sql|postgresql|postgres)?\r?\n([\s\S]*?)\r?\n```/i);
    if (fenceMatch) {
      return fenceMatch[1].trim();
    }
    return trimmed;
  }

  private buildInitialPrompt(
    baseline: RequirementsBaseline,
    revisions: readonly RequirementRevision[],
    policyConstraints: readonly PolicyConstraintRevision[],
    acceptedDecisions: readonly EngineeringDecision[],
    customPrompt?: string
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

    const polHeaderRequirement =
      policyConstraints.length > 0
        ? `   -- @policy-constraints ${policyConstraints.map((p) => p.id).join(', ')}\n`
        : '';

    const edHeaderRequirement =
      acceptedDecisions.length > 0
        ? `   -- @engineering-decisions ${acceptedDecisions.map((d) => d.id).join(', ')}\n`
        : '';

    const requirementsList: string[] = [
      '1. MUST begin with the exact SQL comment provenance header declaring baseline and implemented revision IDs:',
      `   -- @baseline ${baseline.id}`,
      `   -- @requirements ${baseline.requirementRevisions.join(', ')}`
    ];
    if (polHeaderRequirement) {
      requirementsList.push(polHeaderRequirement.trimEnd());
    }
    if (edHeaderRequirement) {
      requirementsList.push(edHeaderRequirement.trimEnd());
    }

    let stepNum = 2;
    if (acceptedDecisions.length > 0) {
      requirementsList.push(
        `${stepNum++}. MUST strictly comply with and implement all Accepted Engineering Decisions above (including primary key types, surrogate key strategies, and column naming).`
      );
    }
    requirementsList.push(
      `${stepNum++}. Primary Key & Surrogate Key Strategy:\n` +
        '   - If an accepted engineering decision specifies the primary key type or strategy (e.g. UUID vs. BIGINT identity), MUST strictly follow that accepted decision.\n' +
        "   - In the absence of an accepted engineering decision specifying an alternative, use UUID surrogate primary keys ('id UUID PRIMARY KEY DEFAULT gen_random_uuid()') as the standard primary key strategy for relational tables.\n" +
        '   - If making an explicit technical choice regarding primary keys, output: -- @decision: <Statement> | <Rationale>',
      `${stepNum++}. Tables, columns, keys, and foreign keys must reflect the business entities and invariants in the authority requirements.`,
      `${stepNum++}. Must be valid PostgreSQL DDL (CREATE TABLE, ALTER TABLE, CREATE INDEX, CHECK constraints, column defaults).`,
      `${stepNum++}. If foreign keys reference other tables, ensure tables are declared in valid dependency order.`,
      `${stepNum++}. Decision Boundary Rules:\n` +
        '   - If making a legitimate technical choice (e.g. index strategy, surrogate keys, optimistic concurrency), output:\n' +
        '     -- @decision: <Statement> | <Rationale>\n' +
        '   - If encountering missing product behavior or policy ambiguity (e.g. undefined cardinality, whether multiple approvals are allowed, retention/encryption rules), DO NOT guess or invent requirements. Output:\n' +
        '     -- @finding: <FindingType> | <Rationale> [| <RequirementRevisionIds>]',
      `${stepNum++}. Return ONLY the executable SQL code enclosed in a \`\`\`sql markdown block without conversational filler.`
    );

    return [
      `Generate a PostgreSQL-compatible relational schema (DDL) for requirements baseline ${baseline.id}:`,
      reqStatements,
      polStatements,
      edStatements,
      customPrompt ? `\nAdditional reviewer instructions:\n${customPrompt}\n` : '',
      'Requirements for generated SQL DDL:',
      ...requirementsList
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  private buildRepairPrompt(
    currentCandidate: string,
    errorMessage: string,
    baseline: RequirementsBaseline,
    acceptedDecisions: readonly EngineeringDecision[]
  ): string {
    const polHeader =
      baseline.policyConstraintRevisions && baseline.policyConstraintRevisions.length > 0
        ? `\n-- @policy-constraints ${baseline.policyConstraintRevisions.join(', ')}`
        : '';

    const edHeader =
      acceptedDecisions.length > 0
        ? `\n-- @engineering-decisions ${acceptedDecisions.map((d) => d.id).join(', ')}`
        : '';

    return [
      'The following PostgreSQL DDL schema failed validation or execution:',
      `${errorMessage}`,
      '',
      'Correct the SQL DDL to fix the error.',
      'Ensure the DDL begins with the required provenance comment headers:',
      `-- @baseline ${baseline.id}`,
      `-- @requirements ${baseline.requirementRevisions.join(', ')}${polHeader}${edHeader}`,
      '',
      'Return ONLY the corrected SQL DDL enclosed in ```sql without commentary:',
      '',
      currentCandidate
    ].join('\n');
  }
}
