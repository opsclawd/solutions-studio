import { createHash, randomUUID } from 'node:crypto';
import {
  now,
  EmptyBaselineError,
  createRequirementsBaselineId,
  createRequirementRevisionId,
  createEngineeringDecisionId,
  createFindingId,
  createStoryId,
  createStory,
  createEngineeringDecision,
  createCandidateFinding,
  FINDING_TYPES,
  type RequirementsBaseline,
  type RequirementsBaselineId,
  type RequirementRevision,
  type PolicyConstraintRevision,
  type EngineeringDecision,
  type CandidateFinding,
  type FindingType,
  type RequirementRevisionId,
  type GherkinStepKeyword
} from '@solutions-studio/domain';
import type { ProjectionMetadataDto } from '@solutions-studio/contracts';
import type { IGenerationGateway } from '../ports/generation/IGenerationGateway.js';
import type {
  IGherkinValidatorGateway,
  ParsedGherkinDocument
} from '../ports/validation/IGherkinValidatorGateway.js';
import type {
  IRequirementsRepository,
  ProjectionRecord,
  StoryRecord
} from '../ports/persistence/IRequirementsRepository.js';
import type { GenerateArtifactOptions, RepairAttemptRecord } from './GenerateArtifactUseCase.js';
import {
  UnknownRequirementRevisionError,
  UnknownRequirementsBaselineError,
  UnknownPolicyConstraintRevisionError,
  UnknownEngineeringDecisionError
} from './ReconciliationErrors.js';
import { StoryProvenanceValidationError } from './StoryProjectionErrors.js';
import {
  UnacceptedEngineeringDecisionError,
  RepairRetryExhaustionError
} from './SqlSchemaProjectionErrors.js';

export interface StoryProjectionResult {
  readonly projectionId: string;
  readonly story: StoryRecord;
  readonly content: string;
  readonly metadata: ProjectionMetadataDto;
  readonly repairHistory: readonly RepairAttemptRecord[];
  readonly proposedEngineeringDecisions?: readonly EngineeringDecision[];
  readonly candidateFindings?: readonly CandidateFinding[];
}

export interface GenerateStoriesProjectionInput {
  readonly baselineId: RequirementsBaselineId | string;
  readonly prompt?: string;
  readonly options?: GenerateArtifactOptions & { model?: string };
  readonly id?: string;
  readonly engineeringDecisionIds?: readonly string[];
  readonly autoRecordDiscoveries?: boolean;
}

export interface DeclaredStoryProvenance {
  readonly baselineId?: string;
  readonly requirementRevisionIds: readonly string[];
  readonly policyConstraintRevisionIds?: readonly string[];
  readonly engineeringDecisionIds?: readonly string[];
}

export interface StoryValidationCandidateResult {
  readonly isValid: boolean;
  readonly errorMessage?: string;
  readonly parsedDocument?: ParsedGherkinDocument;
  readonly declaredProvenance?: DeclaredStoryProvenance;
}

export class GenerateStoriesProjectionUseCase {
  private readonly defaultMaxRepairAttempts = 2;

  constructor(
    private readonly generationGateway: IGenerationGateway,
    private readonly validatorGateway: IGherkinValidatorGateway,
    private readonly repository: IRequirementsRepository,
    private readonly providerName: string = 'fake'
  ) {}

  async execute(input: GenerateStoriesProjectionInput): Promise<StoryProjectionResult> {
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
      for (const edIdStr of input.engineeringDecisionIds) {
        const edId = createEngineeringDecisionId(edIdStr);
        const decision = await this.repository.getEngineeringDecision(edId);
        if (!decision) {
          throw new UnknownEngineeringDecisionError(edIdStr);
        }
        if (decision.baselineId !== baseline.id) {
          throw new StoryProvenanceValidationError(
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
    const initialCandidate = this.extractGherkinContent(initialGeneration.text);

    // 5. Bounded closed-loop repair
    const repairResult = await this.validateAndRepair(
      initialCandidate,
      baseline,
      acceptedDecisions,
      input.options
    );

    const storyId = input.id ? createStoryId(input.id) : createStoryId(`STORY-${randomUUID()}`);
    const projectionId = input.id
      ? input.id.startsWith('PROJ-')
        ? input.id
        : `PROJ-${input.id}`
      : `PROJ-${storyId}`;

    // 6. Discovery Extraction & Lineage Population
    const autoRecord = input.autoRecordDiscoveries !== false;
    const { proposedDecisions, candidateFindings } = await this.extractAndRecordDiscoveries(
      repairResult.content,
      baseline,
      projectionId,
      autoRecord
    );

    // 7. Create Story domain entity and persist StoryRecord + ProjectionRecord
    const parsedDoc = repairResult.parsedDocument;
    const story = createStory({
      id: storyId,
      baselineId: baseline.id,
      title: parsedDoc.title,
      narrative: parsedDoc.narrative ?? {
        role: 'Verified Actor',
        feature: parsedDoc.title,
        benefit: `Deliver value for ${parsedDoc.title}`
      },
      requirementRevisionIds: parsedDoc.declaredRequirementRevisionIds,
      policyConstraintRevisionIds: parsedDoc.declaredPolicyConstraintRevisionIds,
      scenarios: parsedDoc.scenarios.map((s, idx) => ({
        id: s.id ?? `SCENARIO-${idx + 1}`,
        title: s.title,
        requirementRevisionIds: s.declaredRequirementRevisionIds,
        policyConstraintRevisionIds: s.declaredPolicyConstraintRevisionIds,
        steps: s.steps.map((st) => ({
          keyword: st.keyword as GherkinStepKeyword,
          text: st.text
        })),
        rawText: s.rawText
      })),
      gherkinText: repairResult.content,
      dependencies: parsedDoc.declaredStoryDependencies,
      createdAt: now()
    });

    const contentHash = createHash('sha256').update(story.gherkinText).digest('hex');

    const metadata: ProjectionMetadataDto = {
      baselineId: baseline.id,
      requirementRevisionIds: [...baseline.requirementRevisions],
      policyConstraintRevisionIds: baseline.policyConstraintRevisions
        ? [...baseline.policyConstraintRevisions]
        : undefined,
      engineeringDecisionIds:
        acceptedDecisions.length > 0 ? acceptedDecisions.map((d) => d.id) : undefined,
      artifactType: 'stories',
      declaredProvenance: {
        baselineId: repairResult.declaredProvenance.baselineId ?? baseline.id,
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
        artifactType: 'stories'
      },
      measuredVerification: {
        repairsNeeded: repairResult.repairsNeeded,
        attemptCount: repairResult.repairHistory.length + 1,
        contentHash,
        verifiedAt: now()
      }
    };

    const storyRecord: StoryRecord = {
      id: story.id,
      baselineId: story.baselineId,
      projectionId,
      title: story.title,
      narrative: story.narrative,
      requirementRevisionIds: story.requirementRevisionIds,
      policyConstraintRevisionIds: story.policyConstraintRevisionIds,
      scenarios: story.scenarios,
      acceptanceCriteria: story.acceptanceCriteria,
      gherkinText: story.gherkinText,
      metadata,
      dependencies: story.dependencies,
      createdAt: story.createdAt
    };

    const projectionRecord: ProjectionRecord = {
      id: projectionId,
      baselineId: baseline.id,
      requirementRevisionIds: baseline.requirementRevisions,
      policyConstraintRevisionIds: baseline.policyConstraintRevisions,
      engineeringDecisionIds:
        acceptedDecisions.length > 0 ? acceptedDecisions.map((d) => d.id) : undefined,
      artifactType: 'stories',
      content: story.gherkinText,
      metadata,
      createdAt: story.createdAt
    };

    await this.repository.saveStory(storyRecord);
    await this.repository.saveProjectionRecord(projectionRecord);

    return {
      projectionId,
      story: storyRecord,
      content: story.gherkinText,
      metadata,
      repairHistory: repairResult.repairHistory,
      proposedEngineeringDecisions: proposedDecisions,
      candidateFindings
    };
  }

  async validateAndRepair(
    initialCandidate: string,
    baseline: RequirementsBaseline,
    acceptedDecisions: readonly EngineeringDecision[],
    options?: GenerateArtifactOptions
  ): Promise<{
    content: string;
    parsedDocument: ParsedGherkinDocument;
    repairsNeeded: number;
    repairHistory: RepairAttemptRecord[];
    declaredProvenance: DeclaredStoryProvenance;
  }> {
    const maxAttempts = options?.maxRepairAttempts ?? this.defaultMaxRepairAttempts;
    let currentCandidate = this.extractGherkinContent(initialCandidate);
    const repairHistory: RepairAttemptRecord[] = [];

    // Step 1: Initial candidate validation
    const initialValidation = await this.validateCandidate(
      currentCandidate,
      baseline,
      acceptedDecisions
    );
    if (
      initialValidation.isValid &&
      initialValidation.parsedDocument &&
      initialValidation.declaredProvenance
    ) {
      return {
        content: currentCandidate,
        parsedDocument: initialValidation.parsedDocument,
        repairsNeeded: 0,
        repairHistory: [],
        declaredProvenance: initialValidation.declaredProvenance
      };
    }

    repairHistory.push({
      attempt: 0,
      candidate: currentCandidate,
      errorMessage: initialValidation.errorMessage ?? 'Initial candidate validation failed'
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

      const repairGeneration = await this.generationGateway.generate({ prompt: repairPrompt });
      currentCandidate = this.extractGherkinContent(repairGeneration.text);

      const validation = await this.validateCandidate(
        currentCandidate,
        baseline,
        acceptedDecisions
      );
      if (validation.isValid && validation.parsedDocument && validation.declaredProvenance) {
        return {
          content: currentCandidate,
          parsedDocument: validation.parsedDocument,
          repairsNeeded: repairAttempts,
          repairHistory,
          declaredProvenance: validation.declaredProvenance
        };
      }

      repairHistory.push({
        attempt: repairAttempts,
        candidate: currentCandidate,
        errorMessage: validation.errorMessage ?? 'Repair candidate validation failed'
      });
    }

    const errorMessages = repairHistory.map((h) => `Attempt ${h.attempt}: ${h.errorMessage}`);
    throw new RepairRetryExhaustionError(
      `Story projection repair failed after ${maxAttempts} attempt(s). Gherkin text remains invalid or untraceable.`,
      repairAttempts,
      currentCandidate,
      errorMessages
    );
  }

  async validateCandidate(
    gherkinText: string,
    baseline: RequirementsBaseline,
    acceptedDecisions: readonly EngineeringDecision[]
  ): Promise<StoryValidationCandidateResult> {
    const validationResult = await this.validatorGateway.validate(gherkinText);
    if (!validationResult.isValid || !validationResult.parsedDocument) {
      return {
        isValid: false,
        errorMessage: validationResult.errorMessage ?? 'Malformed Gherkin syntax.'
      };
    }

    const parsedDoc = validationResult.parsedDocument;

    // Verify baseline ID
    if (!parsedDoc.declaredBaselineId) {
      return {
        isValid: false,
        errorMessage: `Story missing declared baseline reference: must declare '# @baseline ${baseline.id}'`
      };
    }
    if (parsedDoc.declaredBaselineId !== baseline.id) {
      return {
        isValid: false,
        errorMessage: `Declared baseline '${parsedDoc.declaredBaselineId}' does not match target baseline '${baseline.id}'`
      };
    }

    // Verify story requirement revisions against baseline
    const baselineReqSet = new Set<string>(baseline.requirementRevisions);
    const invalidReqs = parsedDoc.declaredRequirementRevisionIds.filter(
      (id) => !baselineReqSet.has(id)
    );
    if (invalidReqs.length > 0) {
      return {
        isValid: false,
        errorMessage: `Requirement revision(s) [${invalidReqs.join(', ')}] are not members of baseline '${baseline.id}'`
      };
    }

    // Verify policy constraint revisions against baseline
    const baselinePolSet = new Set<string>(baseline.policyConstraintRevisions ?? []);
    if (parsedDoc.declaredPolicyConstraintRevisionIds) {
      const invalidPols = parsedDoc.declaredPolicyConstraintRevisionIds.filter(
        (id) => !baselinePolSet.has(id)
      );
      if (invalidPols.length > 0) {
        return {
          isValid: false,
          errorMessage: `Policy constraint revision(s) [${invalidPols.join(', ')}] are not members of baseline '${baseline.id}'`
        };
      }
    }

    // Verify scenario-level authority traceability
    for (const scenario of parsedDoc.scenarios) {
      if (
        !scenario.declaredRequirementRevisionIds ||
        scenario.declaredRequirementRevisionIds.length === 0
      ) {
        return {
          isValid: false,
          errorMessage: `Scenario '${scenario.title}' must declare at least one authority reference via @requirements:<revId>`
        };
      }

      const invalidScReqs = scenario.declaredRequirementRevisionIds.filter(
        (id) => !baselineReqSet.has(id)
      );
      if (invalidScReqs.length > 0) {
        return {
          isValid: false,
          errorMessage: `Scenario '${scenario.title}' references requirement revision(s) [${invalidScReqs.join(', ')}] not in baseline '${baseline.id}'`
        };
      }

      if (scenario.declaredPolicyConstraintRevisionIds) {
        const invalidScPols = scenario.declaredPolicyConstraintRevisionIds.filter(
          (id) => !baselinePolSet.has(id)
        );
        if (invalidScPols.length > 0) {
          return {
            isValid: false,
            errorMessage: `Scenario '${scenario.title}' references policy constraint revision(s) [${invalidScPols.join(', ')}] not in baseline '${baseline.id}'`
          };
        }
      }
    }

    const declaredProvenance: DeclaredStoryProvenance = {
      baselineId: parsedDoc.declaredBaselineId,
      requirementRevisionIds: parsedDoc.declaredRequirementRevisionIds,
      policyConstraintRevisionIds: parsedDoc.declaredPolicyConstraintRevisionIds,
      engineeringDecisionIds: acceptedDecisions.map((d) => d.id)
    };

    return {
      isValid: true,
      parsedDocument: parsedDoc,
      declaredProvenance
    };
  }

  private async extractAndRecordDiscoveries(
    gherkinContent: string,
    baseline: RequirementsBaseline,
    projectionId: string,
    autoRecord: boolean
  ): Promise<{
    proposedDecisions: EngineeringDecision[];
    candidateFindings: CandidateFinding[];
  }> {
    const candidateFindings: CandidateFinding[] = [];
    const proposedDecisions: EngineeringDecision[] = [];

    // 1. Findings: # @finding: <type> | <rationale> [| <revisions>]
    const findingMatches = gherkinContent.matchAll(
      /#\s*@finding:\s*([^|\r\n]+)\|([^|\r\n]+)(?:\|([^\r\n]+))?/gi
    );
    for (const match of findingMatches) {
      const rawType = match[1].trim();
      const rationale = match[2].trim();
      const rawRevs = match[3]?.trim();

      const findingType: FindingType = FINDING_TYPES.includes(rawType as FindingType)
        ? (rawType as FindingType)
        : 'undefined-cardinality';

      let affectedRevs: RequirementRevisionId[] = [];
      if (rawRevs) {
        const parsed = rawRevs
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        affectedRevs = parsed.map((id) => createRequirementRevisionId(id));
      }
      if (affectedRevs.length === 0) {
        affectedRevs = [...baseline.requirementRevisions];
      }

      const finding = createCandidateFinding({
        id: createFindingId(`FND-${randomUUID()}`),
        type: findingType,
        affectedRequirementRevisions: affectedRevs,
        evidence: [],
        discoveredBy: 'artifact-validation',
        disposition: 'OPEN',
        rationale,
        baselineId: baseline.id,
        originatingProjectionId: projectionId
      });

      candidateFindings.push(finding);
      if (autoRecord) {
        await this.repository.saveCandidateFinding(finding);
      }
    }

    // 2. Decisions: # @decision: <statement> | <rationale>
    const decisionMatches = gherkinContent.matchAll(/#\s*@decision:\s*([^|\r\n]+)\|([^|\r\n]+)/gi);
    for (const match of decisionMatches) {
      const statement = match[1].trim();
      const rationale = match[2].trim();

      const decision = createEngineeringDecision({
        id: createEngineeringDecisionId(`ED-${randomUUID()}`),
        baselineId: baseline.id,
        statement,
        rationale,
        requirementRevisionIds: [...baseline.requirementRevisions],
        policyConstraintRevisionIds: baseline.policyConstraintRevisions
          ? [...baseline.policyConstraintRevisions]
          : [],
        state: 'PROPOSED',
        createdBy: 'artifact-validation'
      });

      proposedDecisions.push(decision);
      if (autoRecord) {
        await this.repository.saveEngineeringDecision(decision);
      }
    }

    return { proposedDecisions, candidateFindings };
  }

  private buildInitialPrompt(
    baseline: RequirementsBaseline,
    revisions: readonly RequirementRevision[],
    policyConstraints: readonly PolicyConstraintRevision[],
    acceptedDecisions: readonly EngineeringDecision[],
    customPrompt?: string
  ): string {
    const lines: string[] = [
      'You are generating an implementation User Story with Gherkin acceptance criteria based on an immutable verified requirements baseline.',
      '',
      `Baseline ID: ${baseline.id}`,
      `Requirement Revisions: ${baseline.requirementRevisions.join(', ')}`,
      '',
      'Authoritative Requirements to Implement:'
    ];

    for (const rev of revisions) {
      lines.push(`- [${rev.id}] ${rev.statement} (Category: ${rev.category})`);
    }

    if (policyConstraints.length > 0) {
      lines.push('', 'Applicable Policy Constraints:');
      for (const pol of policyConstraints) {
        lines.push(`- [${pol.id}] ${pol.statement} (Authority: ${pol.authorityReference})`);
      }
    }

    if (acceptedDecisions.length > 0) {
      lines.push('', 'Accepted Engineering Decisions:');
      for (const ed of acceptedDecisions) {
        lines.push(`- [${ed.id}] ${ed.statement}: ${ed.rationale}`);
      }
    }

    if (customPrompt) {
      lines.push('', 'Custom Instructions:', customPrompt);
    }

    lines.push(
      '',
      'Mandatory Rules & Provenance Contract:',
      `1. Declare exact baseline at the top: '# @baseline ${baseline.id}'`,
      `2. Declare exact requirement revisions: '# @requirements ${baseline.requirementRevisions.join(', ')}'`,
      policyConstraints.length > 0
        ? `3. Declare exact policy constraints: '# @policy-constraints ${policyConstraints.map((p) => p.id).join(', ')}'`
        : '',
      acceptedDecisions.length > 0
        ? `4. Declare engineering decisions: '# @engineering-decisions ${acceptedDecisions.map((d) => d.id).join(', ')}'`
        : '',
      '5. Provide a Feature title and user-story narrative in standard format:',
      '   As a <role>',
      '   I want <feature>',
      '   So that <benefit>',
      '6. Every Scenario MUST declare its requirement traceability tag immediately preceding or on the scenario:',
      '   @requirements:<RevisionId> (e.g. @requirements:REQ-001-R1)',
      '   If policy applies: @policy-constraints:<PolicyRevisionId>',
      '   EVERY SCENARIO MUST REFERENCE AT LEAST ONE REQUIREMENT REVISION FROM THE BASELINE.',
      '7. TRACEABILITY INVARIANT: Never invent product rules or acceptance criteria not grounded in the baseline.',
      '   If you discover missing product rules or ambiguities, emit a candidate finding comment:',
      '   # @finding: <FindingType> | <Rationale> [| <RequirementRevisionIds>]',
      '   Valid finding types: undefined-cardinality, missing-field-boundary, state-transition-gap, orphaned-dependency, authorization-gap, data-type-mismatch, ambiguous-acceptance-criteria, temporal-ambiguity, missing-recovery-path, circular-dependency, missing-evidence, policy-conflict',
      '8. If a technical/architectural implementation choice is required, emit a proposed decision comment:',
      '   # @decision: <Statement> | <Rationale>',
      '',
      'Output ONLY the Gherkin feature specification.'
    );

    return lines.filter((l) => l !== undefined).join('\n');
  }

  private buildRepairPrompt(
    failedCandidate: string,
    errorMessage: string,
    baseline: RequirementsBaseline,
    acceptedDecisions: readonly EngineeringDecision[]
  ): string {
    return [
      'The previous Gherkin story generation failed validation with the following error:',
      errorMessage,
      '',
      'Previous Candidate:',
      '```gherkin',
      failedCandidate,
      '```',
      '',
      `Target Baseline ID: ${baseline.id}`,
      `Allowed Requirement Revisions: ${baseline.requirementRevisions.join(', ')}`,
      baseline.policyConstraintRevisions && baseline.policyConstraintRevisions.length > 0
        ? `Allowed Policy Constraint Revisions: ${baseline.policyConstraintRevisions.join(', ')}`
        : '',
      acceptedDecisions.length > 0
        ? `Accepted Decisions: ${acceptedDecisions.map((d) => d.id).join(', ')}`
        : '',
      '',
      'Repair Instructions:',
      `1. Include '# @baseline ${baseline.id}' and '# @requirements ${baseline.requirementRevisions.join(', ')}'.`,
      '2. Ensure EVERY Scenario has at least one step and declares at least one exact requirement revision tag (e.g. @requirements:REQ-xxx-Ry) present in the baseline.',
      '3. Ensure all declared references match the baseline.',
      '4. If required business behavior is missing, do NOT invent criteria; output # @finding: <FindingType> | <Rationale>.',
      '5. Output ONLY the corrected Gherkin document.'
    ]
      .filter((l) => Boolean(l) || l === '')
      .join('\n');
  }

  private extractGherkinContent(raw: string): string {
    let result = raw.trim();
    if (result.startsWith('```')) {
      const firstNewline = result.indexOf('\n');
      if (firstNewline !== -1) {
        result = result.substring(firstNewline + 1);
      }
    }
    if (result.endsWith('```')) {
      const lastFence = result.lastIndexOf('```');
      result = result.substring(0, lastFence);
    }
    return result.trim();
  }
}
