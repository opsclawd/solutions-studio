import { randomUUID } from 'node:crypto';
import {
  CompiledRequirementsResponseDtoSchema,
  type CompiledRequirementsResponseDto,
  type CandidateEvidenceRefDto,
  type CandidateRequirementDto,
  type CandidateFindingResponseDto
} from '@solutions-studio/contracts';
import {
  createRequirementId,
  createRequirementRevisionId,
  createFindingId,
  createSourceRevisionId,
  createEvidenceLocator,
  createEvidenceReference,
  createRequirementRevision,
  createCandidateFinding,
  REQUIREMENT_CATEGORIES,
  REQUIREMENT_ORIGINS,
  FINDING_TYPES,
  type SourceRevisionId,
  type RequirementRevisionId,
  type FindingId,
  type EvidenceReference,
  type EvidenceLocator
} from '@solutions-studio/domain';
import type {
  IGenerationGateway,
  GenerationMetadata
} from '../ports/generation/IGenerationGateway.js';
import type {
  IRequirementsRepository,
  SourceRevisionRecord,
  LocatorIndexEntry
} from '../ports/persistence/IRequirementsRepository.js';
import {
  EmptySourceRevisionIdsError,
  MalformedGenerationOutputError,
  UnknownSourceRevisionError,
  UnresolvedLocatorError,
  InvalidEvidencelessOriginError,
  UnsafeIdentifierError,
  type CompilationError
} from './CompileRequirementsErrors.js';

export const COMPILER_VERSION = '1.0.0' as const;
export const PROMPT_VERSION = '1.0.0' as const;

function isUnsafeSourceRevisionId(id: string): boolean {
  if (typeof id !== 'string' || id.trim().length === 0) {
    return true;
  }
  if (id !== id.trim()) {
    return true;
  }
  if (id.includes('/') || id.includes('\\') || id.includes('..') || id.includes('\0')) {
    return true;
  }
  return false;
}

function isUnsafeLocator(locator: string): boolean {
  if (typeof locator !== 'string' || locator.trim().length === 0) {
    return true;
  }
  if (locator !== locator.trim()) {
    return true;
  }
  if (locator.includes('\0')) {
    return true;
  }
  return false;
}

function isIdentifierSafetyError(err: unknown): boolean {
  if (err instanceof Error) {
    if (
      err.name === 'EmptyIdentifierError' ||
      err instanceof UnsafeIdentifierError ||
      err.name === 'UnsafeIdentifierError'
    ) {
      return true;
    }
    if (
      /path separators or traversal|identifier cannot be empty|Path traversal detected/i.test(
        err.message
      )
    ) {
      return true;
    }
  }
  return false;
}

export interface CompileRequirementsInput {
  readonly sourceRevisionIds: readonly SourceRevisionId[];
}

export interface RejectedRequirement {
  readonly requirementKey: string;
  readonly error: CompilationError;
  readonly candidate?: CandidateRequirementDto;
}

export interface RejectedFinding {
  readonly findingKey: string;
  readonly error: CompilationError;
  readonly candidate?: CandidateFindingResponseDto;
}

export interface CompileRequirementsResult {
  readonly acceptedRequirementRevisions: readonly RequirementRevisionId[];
  readonly acceptedFindingIds: readonly FindingId[];
  readonly rejectedRequirements: readonly RejectedRequirement[];
  readonly rejectedFindings: readonly RejectedFinding[];
  readonly rawResponse: CompiledRequirementsResponseDto;
  readonly generationMetadata?: GenerationMetadata;
}

export class CompileRequirementsUseCase {
  constructor(
    private readonly generationGateway: IGenerationGateway,
    private readonly repository: IRequirementsRepository
  ) {}

  async compile(input: CompileRequirementsInput): Promise<CompileRequirementsResult> {
    if (!input.sourceRevisionIds || input.sourceRevisionIds.length === 0) {
      throw new EmptySourceRevisionIdsError();
    }

    const records: SourceRevisionRecord[] = [];
    for (const id of input.sourceRevisionIds) {
      if (
        typeof id !== 'string' ||
        id.length === 0 ||
        id !== id.trim() ||
        isUnsafeSourceRevisionId(id)
      ) {
        throw new UnknownSourceRevisionError(
          id,
          `Caller-specified source revision '${id}' is invalid or does not exist`
        );
      }

      let record: SourceRevisionRecord | undefined;
      try {
        const sourceRevId = createSourceRevisionId(id);
        record = await this.repository.getSourceRevision(sourceRevId);
      } catch (err) {
        if (isIdentifierSafetyError(err)) {
          throw new UnknownSourceRevisionError(
            id,
            `Caller-specified source revision '${id}' is invalid or does not exist`
          );
        }
        throw err;
      }
      if (!record || record.revision.id !== id) {
        throw new UnknownSourceRevisionError(
          id,
          `Caller-specified source revision '${id}' does not exist`
        );
      }
      records.push(record);
    }

    const prompt = this.buildPrompt(records);
    const generationResult = await this.generationGateway.generate({ prompt });

    const jsonText = this.extractJsonContent(generationResult.text);
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(jsonText);
    } catch (err) {
      throw new MalformedGenerationOutputError(generationResult.text, undefined, err);
    }

    const parseResult = CompiledRequirementsResponseDtoSchema.safeParse(parsedJson);
    if (!parseResult.success) {
      throw new MalformedGenerationOutputError(
        generationResult.text,
        parseResult.error.issues,
        parseResult.error
      );
    }

    const rawResponse = parseResult.data;
    const acceptedRequirementRevisions: RequirementRevisionId[] = [];
    const rejectedRequirements: RejectedRequirement[] = [];
    const requirementKeyMap = new Map<string, RequirementRevisionId>();

    for (const reqDto of rawResponse.requirements) {
      const requirementKey = reqDto.requirementKey;

      const evidenceValidation = await this.validateEvidence(reqDto.evidence);
      if (!evidenceValidation.ok) {
        rejectedRequirements.push({
          requirementKey,
          error: evidenceValidation.error,
          candidate: reqDto
        });
        continue;
      }

      if (
        (reqDto.origin === 'EXPLICIT' || reqDto.origin === 'INFERRED') &&
        evidenceValidation.refs.length === 0
      ) {
        rejectedRequirements.push({
          requirementKey,
          error: new InvalidEvidencelessOriginError(requirementKey, reqDto.origin),
          candidate: reqDto
        });
        continue;
      }

      const reqUuid = randomUUID();
      const reqId = createRequirementId(`REQ-${reqUuid}`);
      const revId = createRequirementRevisionId(`REQ-${reqUuid}-R1`);

      const revision = createRequirementRevision({
        id: revId,
        requirementId: reqId,
        revision: 1,
        statement: reqDto.statement,
        category: reqDto.category,
        origin: reqDto.origin,
        reviewState: 'PENDING',
        resolutionState: 'UNRESOLVED',
        evidence: evidenceValidation.refs,
        rationale: reqDto.rationale
      });

      await this.repository.saveRequirementRevision(revision);
      acceptedRequirementRevisions.push(revision.id);
      requirementKeyMap.set(requirementKey, revision.id);
    }

    const acceptedFindingIds: FindingId[] = [];
    const rejectedFindings: RejectedFinding[] = [];

    for (const findingDto of rawResponse.findings) {
      const findingKey = findingDto.findingKey;

      const evidenceValidation = await this.validateEvidence(findingDto.evidence);
      if (!evidenceValidation.ok) {
        rejectedFindings.push({
          findingKey,
          error: evidenceValidation.error,
          candidate: findingDto
        });
        continue;
      }

      const affectedRequirementRevisions: RequirementRevisionId[] = [];
      for (const key of findingDto.relatedRequirementKeys) {
        const mappedRevId = requirementKeyMap.get(key);
        if (mappedRevId) {
          affectedRequirementRevisions.push(mappedRevId);
        }
      }

      const findingUuid = randomUUID();
      const findingId = createFindingId(`FINDING-${findingUuid}`);

      const finding = createCandidateFinding({
        id: findingId,
        type: findingDto.type,
        affectedRequirementRevisions,
        evidence: evidenceValidation.refs,
        discoveredBy: 'model',
        disposition: 'OPEN',
        rationale: findingDto.rationale
      });

      await this.repository.saveCandidateFinding(finding);
      acceptedFindingIds.push(finding.id);
    }

    return {
      acceptedRequirementRevisions,
      acceptedFindingIds,
      rejectedRequirements,
      rejectedFindings,
      rawResponse,
      generationMetadata: generationResult.metadata
    };
  }

  private buildPrompt(records: readonly SourceRevisionRecord[]): string {
    const revisionsDoc = records
      .map((rec) => {
        const locatorsList = rec.locatorIndex
          .map(
            (loc) =>
              `  - Locator: "${loc.locator}" (Heading: "${loc.headingPath}", Label: "${loc.blockLabel}"): "${loc.text.replace(/\n/g, ' ')}"`
          )
          .join('\n');

        return `### Source Revision: ${rec.revision.id}
Source ID: ${rec.revision.sourceId}
Revision Number: ${rec.revision.revision}
Captured At: ${rec.revision.capturedAt}

Available Locators:
${locatorsList}

Source Text:
\`\`\`markdown
${rec.rawText}
\`\`\``;
      })
      .join('\n\n');

    return `You are a requirements compiler. Your task is to analyze the following source revision(s) and compile candidate requirements and candidate findings (defects, contradictions, or gaps) with exact provenance.

${revisionsDoc}

## Output Format
You must respond with ONLY a JSON object conforming to the following structure:
\`\`\`json
{
  "requirements": [
    {
      "requirementKey": "model-local-key",
      "statement": "Requirement statement",
      "category": "<category>",
      "origin": "<origin>",
      "evidence": [
        {
          "sourceRevisionId": "exact-source-revision-id",
          "locator": "exact-locator-from-available-list"
        }
      ],
      "rationale": "optional rationale"
    }
  ],
  "findings": [
    {
      "findingKey": "model-local-finding-key",
      "type": "<finding-type>",
      "relatedRequirementKeys": ["model-local-key"],
      "evidence": [
        {
          "sourceRevisionId": "exact-source-revision-id",
          "locator": "exact-locator-from-available-list"
        }
      ],
      "rationale": "Explanation of detected defect/contradiction/gap"
    }
  ]
}
\`\`\`

## Rules:
1. Allowed categories: ${REQUIREMENT_CATEGORIES.join(', ')}.
2. Allowed origins: ${REQUIREMENT_ORIGINS.join(', ')}.
3. For EXPLICIT and INFERRED requirements, evidence MUST NOT be empty.
4. For ASSUMED and GENERATED_PROPOSAL requirements, evidence may be empty.
5. Every evidence reference must specify an existing sourceRevisionId and an exact locator matching one in the Available Locators list.
6. Allowed finding types: ${FINDING_TYPES.join(', ')}.
7. Findings must provide a non-empty rationale explaining the issue.
8. Output ONLY the valid JSON object, without commentary.`;
  }

  private extractJsonContent(text: string): string {
    const trimmed = text.trim();
    const fenceMatch = trimmed.match(/```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```/i);
    if (fenceMatch) {
      return fenceMatch[1].trim();
    }
    return trimmed;
  }

  private async validateEvidence(
    evidence: readonly CandidateEvidenceRefDto[]
  ): Promise<{ ok: true; refs: EvidenceReference[] } | { ok: false; error: CompilationError }> {
    const validRefs: EvidenceReference[] = [];

    for (const ref of evidence) {
      // 1. Strict exactness & safe identifier checks on sourceRevisionId
      if (
        typeof ref.sourceRevisionId !== 'string' ||
        ref.sourceRevisionId.length === 0 ||
        ref.sourceRevisionId !== ref.sourceRevisionId.trim() ||
        isUnsafeSourceRevisionId(ref.sourceRevisionId)
      ) {
        return {
          ok: false,
          error: new UnknownSourceRevisionError(ref.sourceRevisionId)
        };
      }

      let sourceRevId: SourceRevisionId;
      try {
        sourceRevId = createSourceRevisionId(ref.sourceRevisionId);
      } catch (err) {
        if (isIdentifierSafetyError(err)) {
          return {
            ok: false,
            error: new UnknownSourceRevisionError(ref.sourceRevisionId)
          };
        }
        throw err;
      }

      // Verify createSourceRevisionId did not normalize or alter the value
      if ((sourceRevId as string) !== ref.sourceRevisionId) {
        return {
          ok: false,
          error: new UnknownSourceRevisionError(ref.sourceRevisionId)
        };
      }

      let record: SourceRevisionRecord | undefined;
      try {
        record = await this.repository.getSourceRevision(sourceRevId);
      } catch (err) {
        if (isIdentifierSafetyError(err)) {
          return {
            ok: false,
            error: new UnknownSourceRevisionError(ref.sourceRevisionId)
          };
        }
        // Operational repository failures MUST abort compilation
        throw err;
      }

      if (!record || record.revision.id !== ref.sourceRevisionId) {
        return {
          ok: false,
          error: new UnknownSourceRevisionError(ref.sourceRevisionId)
        };
      }

      // 2. Strict exactness & safe identifier checks on locator
      if (
        typeof ref.locator !== 'string' ||
        ref.locator.length === 0 ||
        ref.locator !== ref.locator.trim() ||
        isUnsafeLocator(ref.locator)
      ) {
        return {
          ok: false,
          error: new UnresolvedLocatorError(ref.sourceRevisionId, ref.locator)
        };
      }

      let evidenceLocator: EvidenceLocator;
      try {
        evidenceLocator = createEvidenceLocator(ref.locator);
      } catch (err) {
        if (isIdentifierSafetyError(err)) {
          return {
            ok: false,
            error: new UnresolvedLocatorError(ref.sourceRevisionId, ref.locator)
          };
        }
        throw err;
      }

      // Verify createEvidenceLocator did not normalize or alter the value
      if ((evidenceLocator as string) !== ref.locator) {
        return {
          ok: false,
          error: new UnresolvedLocatorError(ref.sourceRevisionId, ref.locator)
        };
      }

      let locatorEntry: LocatorIndexEntry | undefined;
      try {
        locatorEntry = await this.repository.resolveLocator(sourceRevId, evidenceLocator);
      } catch (err) {
        if (isIdentifierSafetyError(err)) {
          return {
            ok: false,
            error: new UnresolvedLocatorError(ref.sourceRevisionId, ref.locator)
          };
        }
        // Operational repository failures MUST abort compilation
        throw err;
      }

      if (!locatorEntry || locatorEntry.locator !== ref.locator) {
        return {
          ok: false,
          error: new UnresolvedLocatorError(ref.sourceRevisionId, ref.locator)
        };
      }

      const matchingLocatorEntry = record.locatorIndex.find((e) => e.locator === ref.locator);
      if (!matchingLocatorEntry) {
        return {
          ok: false,
          error: new UnresolvedLocatorError(ref.sourceRevisionId, ref.locator)
        };
      }

      validRefs.push(createEvidenceReference(sourceRevId, evidenceLocator));
    }

    return { ok: true, refs: validRefs };
  }
}
