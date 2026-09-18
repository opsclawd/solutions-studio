import { createHash, randomUUID } from 'node:crypto';
import {
  now,
  EmptyBaselineError,
  createRequirementsBaselineId,
  type RequirementsBaseline,
  type RequirementsBaselineId,
  type RequirementRevision
} from '@solutions-studio/domain';
import type { ProjectionMetadataDto } from '@solutions-studio/contracts';
import type { IGenerationGateway } from '../ports/generation/IGenerationGateway.js';
import type { IPrototypeValidatorGateway } from '../ports/validation/IPrototypeValidatorGateway.js';
import type {
  IRequirementsRepository,
  ProjectionRecord
} from '../ports/persistence/IRequirementsRepository.js';
import type { GenerateArtifactOptions, RepairAttemptRecord } from './GenerateArtifactUseCase.js';
import {
  UnknownRequirementRevisionError,
  UnknownRequirementsBaselineError
} from './ReconciliationErrors.js';
import {
  PrototypeProvenanceValidationError,
  RepairRetryExhaustionError
} from './PrototypeProjectionErrors.js';

export interface BaselineProjectionResult {
  readonly projectionId: string;
  readonly content: string;
  readonly metadata: ProjectionMetadataDto;
  readonly repairHistory: readonly RepairAttemptRecord[];
}

export interface GeneratePrototypeProjectionInput {
  readonly baselineId: RequirementsBaselineId | string;
  readonly prompt?: string;
  readonly options?: GenerateArtifactOptions;
  readonly id?: string;
}

export interface DeclaredPrototypeProvenance {
  readonly baselineId: string;
  readonly requirementRevisionIds: readonly string[];
}

export interface PrototypeProvenanceValidationResult {
  readonly isValid: boolean;
  readonly errorMessage?: string;
  readonly extraneousIds?: readonly string[];
  readonly declaredProvenance?: DeclaredPrototypeProvenance;
}

export class GeneratePrototypeProjectionUseCase {
  private readonly defaultMaxRepairAttempts = 2;

  constructor(
    private readonly generationGateway: IGenerationGateway,
    private readonly validatorGateway: IPrototypeValidatorGateway,
    private readonly repository: IRequirementsRepository,
    private readonly providerName: string = 'fake'
  ) {}

  async execute(input: GeneratePrototypeProjectionInput): Promise<BaselineProjectionResult> {
    const baselineId = createRequirementsBaselineId(input.baselineId);
    const baseline = await this.repository.getRequirementsBaseline(baselineId);
    if (!baseline) {
      throw new UnknownRequirementsBaselineError(input.baselineId);
    }

    if (!baseline.requirementRevisions || baseline.requirementRevisions.length === 0) {
      throw new EmptyBaselineError();
    }

    const revisions: RequirementRevision[] = [];
    for (const revId of baseline.requirementRevisions) {
      const rev = await this.repository.getRequirementRevision(revId);
      if (!rev) {
        throw new UnknownRequirementRevisionError(revId);
      }
      revisions.push(rev);
    }

    const defaultPrompt = this.buildInitialPrompt(baseline, revisions, input.prompt);
    const initialGeneration = await this.generationGateway.generate({ prompt: defaultPrompt });
    const initialCandidate = this.extractTsxContent(initialGeneration.text);

    const repairResult = await this.validateAndRepair(initialCandidate, baseline, input.options);

    const contentHash = createHash('sha256').update(repairResult.content).digest('hex');

    const metadata: ProjectionMetadataDto = {
      baselineId: baseline.id,
      requirementRevisionIds: [...baseline.requirementRevisions],
      artifactType: 'prototype',
      declaredProvenance: {
        baselineId: repairResult.declaredProvenance.baselineId,
        requirementRevisionIds: [...repairResult.declaredProvenance.requirementRevisionIds]
      },
      configuredExecution: {
        provider: this.providerName,
        artifactType: 'prototype'
      },
      measuredVerification: {
        repairsNeeded: repairResult.repairsNeeded,
        attemptCount: repairResult.repairHistory.length + 1,
        contentHash,
        verifiedAt: now()
      }
    };

    const projectionId = input.id ?? `PROJ-${randomUUID()}`;
    const record: ProjectionRecord = {
      id: projectionId,
      baselineId: baseline.id,
      requirementRevisionIds: baseline.requirementRevisions,
      artifactType: 'prototype',
      content: repairResult.content,
      metadata,
      createdAt: now()
    };

    await this.repository.saveProjectionRecord(record);

    return {
      projectionId,
      content: repairResult.content,
      metadata,
      repairHistory: repairResult.repairHistory
    };
  }

  /**
   * Validates declared provenance and Babel syntax with bounded closed-loop repair.
   */
  async validateAndRepair(
    initialCandidate: string,
    baseline: RequirementsBaseline,
    options?: GenerateArtifactOptions
  ): Promise<{
    content: string;
    repairsNeeded: number;
    repairHistory: RepairAttemptRecord[];
    declaredProvenance: DeclaredPrototypeProvenance;
  }> {
    const maxAttempts = options?.maxRepairAttempts ?? this.defaultMaxRepairAttempts;
    let currentCandidate = this.extractTsxContent(initialCandidate);
    const repairHistory: RepairAttemptRecord[] = [];

    // Step 1: Initial validation
    const initialValidation = await this.validateCandidate(currentCandidate, baseline);
    if (initialValidation.isValid && initialValidation.declaredProvenance) {
      return {
        content: currentCandidate,
        repairsNeeded: 0,
        repairHistory: [],
        declaredProvenance: initialValidation.declaredProvenance
      };
    }

    // Candidate is invalid, record failure and enter repair loop
    repairHistory.push({
      attempt: 0,
      candidate: currentCandidate,
      errorMessage: initialValidation.errorMessage ?? 'Unknown validation error'
    });

    let repairAttempts = 0;
    while (repairAttempts < maxAttempts) {
      repairAttempts++;
      const lastError = repairHistory[repairHistory.length - 1].errorMessage;
      const repairPrompt = this.buildRepairPrompt(currentCandidate, lastError, baseline);

      const repairGeneration = await this.generationGateway.generate({
        prompt: repairPrompt
      });

      currentCandidate = this.extractTsxContent(repairGeneration.text);
      const validation = await this.validateCandidate(currentCandidate, baseline);

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
      `Prototype repair failed after ${maxAttempts} attempt(s). Prototype TSX remains invalid.`,
      repairAttempts,
      currentCandidate,
      errorMessages
    );
  }

  /**
   * Validates a candidate TSX string for both provenance constraints and Babel AST syntax.
   */
  async validateCandidate(
    code: string,
    baseline: RequirementsBaseline
  ): Promise<{
    isValid: boolean;
    errorMessage?: string;
    declaredProvenance?: DeclaredPrototypeProvenance;
  }> {
    // 1. Provenance check
    const provResult = this.validateProvenance(code, baseline);
    if (!provResult.isValid) {
      return {
        isValid: false,
        errorMessage: provResult.errorMessage
      };
    }

    // 2. Syntax and module whitelist check
    const syntaxResult = await this.validatorGateway.validate(code);
    if (!syntaxResult.isValid) {
      return {
        isValid: false,
        errorMessage: syntaxResult.errorMessage ?? 'Prototype TSX syntax validation failed.'
      };
    }

    return {
      isValid: true,
      declaredProvenance: provResult.declaredProvenance
    };
  }

  /**
   * Deterministically validates declared baseline ID and requirement revision IDs against baseline membership.
   */
  validateProvenance(
    code: string,
    baseline: RequirementsBaseline
  ): PrototypeProvenanceValidationResult {
    const extracted = this.extractDeclaredProvenance(code);

    if (!extracted.baselineId) {
      return {
        isValid: false,
        errorMessage:
          "Missing or malformed '@baseline' declaration in TSX JSDoc header. Expected '@baseline " +
          baseline.id +
          "'."
      };
    }

    if (extracted.baselineId !== baseline.id) {
      return {
        isValid: false,
        errorMessage: `Declared baseline ID '${extracted.baselineId}' does not match expected baseline '${baseline.id}'.`
      };
    }

    if (extracted.requirementRevisionIds.length === 0) {
      return {
        isValid: false,
        errorMessage:
          "Missing or malformed '@requirements' declaration in TSX JSDoc header. Expected revision IDs from baseline: [" +
          baseline.requirementRevisions.join(', ') +
          '].'
      };
    }

    const baselineRevSet = new Set<string>(baseline.requirementRevisions);
    const extraneousIds = extracted.requirementRevisionIds.filter((id) => !baselineRevSet.has(id));

    if (extraneousIds.length > 0) {
      return {
        isValid: false,
        errorMessage: `Declared requirement revision ID(s) [${extraneousIds.join(', ')}] are not members of baseline '${baseline.id}'. Allowed revisions: [${baseline.requirementRevisions.join(', ')}].`,
        extraneousIds
      };
    }

    return {
      isValid: true,
      declaredProvenance: {
        baselineId: extracted.baselineId,
        requirementRevisionIds: extracted.requirementRevisionIds
      }
    };
  }

  /**
   * Asserts valid provenance or throws PrototypeProvenanceValidationError.
   */
  assertValidProvenance(code: string, baseline: RequirementsBaseline): DeclaredPrototypeProvenance {
    const result = this.validateProvenance(code, baseline);
    if (!result.isValid || !result.declaredProvenance) {
      throw new PrototypeProvenanceValidationError(
        result.errorMessage ?? 'Invalid prototype provenance',
        result.extraneousIds ?? [],
        baseline.requirementRevisions,
        baseline.id
      );
    }
    return result.declaredProvenance;
  }

  /**
   * Extracts declared baseline and requirement revision IDs from TSX annotations.
   */
  extractDeclaredProvenance(code: string): {
    baselineId?: string;
    requirementRevisionIds: string[];
  } {
    const baselineMatch = code.match(/@baseline\s*[:\s]\s*([A-Za-z0-9_-]+)/i);
    const baselineId = baselineMatch ? baselineMatch[1] : undefined;

    const reqMatches = [...code.matchAll(/@(?:requirements|implements)\s*[:\s]\s*([^\r\n*]+)/gi)];
    const rawIds: string[] = [];
    for (const match of reqMatches) {
      const parts = match[1]
        .split(/[\s,]+/)
        .map((s) => s.trim().replace(/^\[|\]$/g, ''))
        .filter((s) => s.length > 0);
      rawIds.push(...parts);
    }

    const requirementRevisionIds = [...new Set(rawIds)];

    return {
      baselineId,
      requirementRevisionIds
    };
  }

  private extractTsxContent(text: string): string {
    const trimmed = text.trim();
    const fenceMatch = trimmed.match(
      /```(?:tsx|jsx|typescript|javascript|react)?\r?\n([\s\S]*?)\r?\n```/i
    );
    if (fenceMatch) {
      return fenceMatch[1].trim();
    }
    return trimmed;
  }

  private buildInitialPrompt(
    baseline: RequirementsBaseline,
    revisions: readonly RequirementRevision[],
    customPrompt?: string
  ): string {
    const reqStatements = revisions
      .map((r) => `- [${r.id}] (${r.category}) ${r.statement}`)
      .join('\n');

    return [
      `Generate an interactive React/TSX prototype component for requirements baseline ${baseline.id}:`,
      reqStatements,
      customPrompt ? `\nAdditional reviewer instructions:\n${customPrompt}\n` : '',
      'Requirements for generated TSX:',
      '1. MUST begin with the exact JSDoc provenance header declaring baseline and implemented revision IDs:',
      '   /**',
      `    * @baseline ${baseline.id}`,
      `    * @requirements ${baseline.requirementRevisions.join(', ')}`,
      '    */',
      "2. MUST export a single default React functional component (e.g. 'export default function App() { ... }').",
      "3. Only imports from 'react', 'react-dom', and 'react/jsx-runtime' are allowed (useState, useEffect, useMemo, useCallback). Do NOT import external libraries or styles.",
      '4. Use Tailwind CSS utility classes for styling (buttons, inputs, cards, status badges, layout).',
      '5. Implement interactive UI controls that demonstrate dynamic form behavior, state transitions, validation thresholds, and role-based views reflecting the requirements.',
      '6. Return ONLY the TypeScript/React code enclosed in a ```tsx markdown block without conversational filler.'
    ].join('\n');
  }

  private buildRepairPrompt(
    currentCandidate: string,
    errorMessage: string,
    baseline: RequirementsBaseline
  ): string {
    return [
      `The following TSX prototype failed validation:`,
      `${errorMessage}`,
      '',
      'Correct the TSX code to fix the error.',
      'Ensure the code begins with the required provenance declaration:',
      '/**',
      ` * @baseline ${baseline.id}`,
      ` * @requirements ${baseline.requirementRevisions.join(', ')}`,
      ' */',
      "Ensure the component is exported as default ('export default function App() { ... }').",
      'Return ONLY the corrected TSX code enclosed in ```tsx without commentary:',
      '',
      currentCandidate
    ].join('\n');
  }
}
