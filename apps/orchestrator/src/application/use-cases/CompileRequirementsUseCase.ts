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
  CANDIDATE_REQUIREMENT_ORIGINS,
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
  UnresolvedRequirementKeyError,
  UnsafeIdentifierError,
  type CompilationError
} from './CompileRequirementsErrors.js';

export const COMPILER_VERSION = '1.0.0' as const;
export const PROMPT_VERSION = '1.1.0' as const;

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

    const allowedSourceRevisionIds = new Set<string>(records.map((r) => r.revision.id as string));

    const rawResponse = parseResult.data;
    const acceptedRequirementRevisions: RequirementRevisionId[] = [];
    const rejectedRequirements: RejectedRequirement[] = [];
    const requirementKeyMap = new Map<string, RequirementRevisionId>();

    for (const reqDto of rawResponse.requirements) {
      const requirementKey = reqDto.requirementKey;

      const evidenceValidation = await this.validateEvidence(
        reqDto.evidence,
        allowedSourceRevisionIds
      );
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

      const evidenceValidation = await this.validateEvidence(
        findingDto.evidence,
        allowedSourceRevisionIds
      );
      if (!evidenceValidation.ok) {
        rejectedFindings.push({
          findingKey,
          error: evidenceValidation.error,
          candidate: findingDto
        });
        continue;
      }

      const affectedRequirementRevisions: RequirementRevisionId[] = [];
      const unmappedRequirementKeys: string[] = [];
      for (const key of findingDto.relatedRequirementKeys) {
        const mappedRevId = requirementKeyMap.get(key);
        if (mappedRevId) {
          affectedRequirementRevisions.push(mappedRevId);
        } else {
          unmappedRequirementKeys.push(key);
        }
      }

      if (
        findingDto.relatedRequirementKeys.length > 0 &&
        affectedRequirementRevisions.length === 0
      ) {
        rejectedFindings.push({
          findingKey,
          error: new UnresolvedRequirementKeyError(findingKey, unmappedRequirementKeys),
          candidate: findingDto
        });
        continue;
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

        const supersedesLine = rec.revision.supersedes
          ? `- Supersedes: ${rec.revision.supersedes}\n`
          : '';

        const sourceTypeDisplay = rec.sourceType ? rec.sourceType.toUpperCase() : 'UNSPECIFIED';

        return `### Source Revision: ${rec.revision.id}
- Source Type: ${sourceTypeDisplay} (authority hierarchy: policy/schema > sop > interview/spreadsheet)
- Captured At: ${rec.revision.capturedAt}
- Source ID: ${rec.revision.sourceId}
- Revision Number: ${rec.revision.revision}
${supersedesLine}
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

## Source Authority & Recency Hierarchy
1. Relative Authority Ranking:
   - \`policy\` and \`schema\` are authoritative and mandatory governance definitions (highest precedence).
   - \`sop\` represents operational standard operating procedures and guidelines (medium precedence).
   - \`interview\` and \`spreadsheet\` are informal, operational, or reported practices (lowest precedence).
2. Authority Conflicts:
   - When an informal source (\`interview\`, \`spreadsheet\`) describes operational practices or exceptions that directly conflict with or violate an authoritative source (\`policy\`, \`schema\`), flag this as a \`contradiction\` finding citing both sources as evidence.
3. Recency & Supersession:
   - When two sources of the same authority level conflict, prefer the more recent source (by \`Captured At\`) or the revision that explicitly declares \`Supersedes\`.
   - If a source revision declares that it \`Supersedes\` a prior revision and their requirements or limits differ materially, extract the active requirement from the superseding revision, and flag a \`contradiction\` finding citing both revisions as evidence.

## Cross-Source Analysis Instructions
When compiling across multiple source revisions, you MUST perform pairwise cross-source analysis:
1. Topic Overlap: Scan across all source revisions for overlapping topics, shared workflows, permissions, and numeric thresholds.
2. Contradiction Findings: If two sources make incompatible assertions on the same topic:
   - Emit a candidate finding with \`type: "contradiction"\`.
   - The finding's \`evidence\` MUST cite the exact locators from BOTH conflicting source revisions.
   - The finding's \`relatedRequirementKeys\` MUST reference the candidate requirement keys from each source involved.
   - The finding's \`rationale\` must clearly explain how the two sources contradict each other.
3. Superseded Source Revisions: If a source revision supersedes an earlier revision and updates a threshold, rule, or permission:
   - Extract candidate requirements reflecting the current, active revision.
   - Emit a \`contradiction\` finding citing evidence from BOTH the superseded revision and the superseding revision.
   - The finding's \`relatedRequirementKeys\` MUST cite the candidate requirement key for the active rule.

## Evidence Standard & Precision Calibration (Preventing False Positives)
To maintain high precision and avoid spurious findings:
1. Direct Unambiguous Textual Evidence Required: Only emit a finding when there is direct, unambiguous textual evidence of an actual conflict or defect. Do NOT emit findings based on speculation, plausible inferences, out-of-scope assumptions, or slight differences in phrasing.
2. Scoped & Partitioned Thresholds Are NOT Contradictions: When differing limits, numbers, or rules apply to distinct, explicitly and exhaustively partitioned, mutually exclusive domains, territories, or tiers (e.g., Standard Ground delivery cap $5,000 vs. Express Air delivery cap $25,000), they are complementary domain rules, NOT a contradiction. Do NOT emit a finding when conditions/scopes do not overlap. Differing thresholds applying to the same approval authority, role, or action without an explicit and exhaustive scope partition ARE genuine contradictions.
3. Paraphrased & Semantically Equivalent Phrasing Is NOT a Contradiction: When two sources express the same underlying requirement using different phrasing (e.g., "within 48 hours of initial provisioning" vs. "no later than 48 hours following initial account provisioning"), they are semantically consistent. Do NOT emit a contradiction finding for paraphrasing.
4. Presumption of Validity: When an authoritative document does not mention an operational detail, do NOT assume a defect exists unless the text explicitly creates a gap or contradiction.

## Requirement Category Classification Guidelines
Every extracted requirement MUST be classified into exactly one of the allowed categories:
1. \`business-rule\`: A rule defining a business constraint, numeric threshold, financial or approval limit, condition, calculation, or operational schedule:
   - Approval & Authorization Thresholds: Rules that state a threshold, monetary limit, or condition governing approval authority (e.g. "purchase orders over $50,000 require CFO approval", "department managers may authorize leases up to $75,000 without Executive Committee approval") MUST be classified as \`business-rule\`. The governing constraint is the threshold/condition on the action.
   - Contrast with Role Assignment: Even if an approval rule explicitly mentions the approving role or job title, classify it as \`business-rule\` whenever it defines a threshold or condition for that approval.
   - Do NOT Split Threshold Requirements: Do NOT split a requirement that defines an approval threshold into two separate candidates (e.g. do NOT create one \`business-rule\` for the threshold and a duplicate \`actors-permissions\` for the approving role). Keep it unified as a single \`business-rule\` candidate.
   - Automated Schedules & Workers: Rules specifying when, how often, or under what conditions background jobs, settlement processes, sync workers, or maintenance routines run (e.g. "the reconciliation worker runs periodically throughout the day", "archival process executes periodically") are operational \`business-rule\`s, NOT \`actors-permissions\`. Background workers and automated jobs are system processes, not human actors.
2. \`actors-permissions\`: A rule defining who is authorized to perform an action, role capabilities, user privileges, persona responsibilities, or access control boundaries WITHOUT a numeric or conditional threshold (e.g. "Tier 1 support agents may override MFA credentials", "Only InfoSec officers may approve security exceptions", "database administration access is restricted to primary DBA personnel").
3. \`lifecycle-state\`: States, stages, and valid status transitions in an entity's lifecycle (e.g. "order states are QUEUED, PROCESSING, COMPLETED").
4. \`data-constraint\`: Data format, schema validation, field types, cardinality, retention tags, and uniqueness rules.
5. \`integration\`: External systems, APIs, endpoints, webhook protocols, or third-party service communications.
6. \`failure-behavior\`: Error handling, retries, fallbacks, recovery mechanisms, timeouts, and circuit breakers.
7. \`exception\`: Informal workarounds, undocumented overrides, emergency bypasses, or operational practices deviating from official policy.
8. \`nfr\`: Non-functional requirements including performance targets, latency, throughput, availability, and uptime SLAs.

## Few-Shot Contrastive Examples

### Example 1: Genuine Contradiction — Source Authority Conflict (Policy vs. Interview)
Sources:
- \`INT-OPS-002-R1\` (Source Type: INTERVIEW, Locator: \`facility-access-notes#5.1\`):
  "Operations staff routinely share badge access or prop open exterior loading dock doors during overnight inventory shifts..."
- \`POL-ACCESS-002-R1\` (Source Type: POLICY, Locator: \`physical-security-standards#2.4\`):
  "Under no circumstances may exterior doors be propped open or access badges shared between personnel. All entries to company facilities require individual electronic badge authentication..."
Compiler Output:
- Requirements:
  - \`REQ-AFTERHOURS-PRACTICE\` (category: \`exception\`, origin: \`EXPLICIT\`, evidence: \`[{"sourceRevisionId": "INT-OPS-002-R1", "locator": "facility-access-notes#5.1"}]\`)
  - \`REQ-ACCESS-POLICY\` (category: \`business-rule\`, origin: \`EXPLICIT\`, evidence: \`[{"sourceRevisionId": "POL-ACCESS-002-R1", "locator": "physical-security-standards#2.4"}]\`)
- Findings:
  - Emit finding: \`type: "contradiction"\`, \`relatedRequirementKeys: ["REQ-AFTERHOURS-PRACTICE", "REQ-ACCESS-POLICY"]\`, \`evidence: [{"sourceRevisionId": "INT-OPS-002-R1", "locator": "facility-access-notes#5.1"}, {"sourceRevisionId": "POL-ACCESS-002-R1", "locator": "physical-security-standards#2.4"}]\`, \`rationale: "Operations interview describes staff propping open loading dock doors and sharing badges during overnight shifts, directly violating authoritative physical security policy requiring individual badge authentication and prohibiting propping exterior doors."\`
Explanation: Genuine contradiction between facility practice reported in an interview and corporate policy. Evidence spans both sources.

### Example 2: Genuine Contradiction — Superseded Source Revision
Sources:
- \`SOP-WRITEOFF-004-R1\` (Source Type: SOP, Revision: 1, Locator: \`writeoff-approval-limits#3.1\`):
  "Warehouse supervisors may authorize inventory write-offs of damaged stock up to $10,000 per incident without regional manager sign-off."
- \`SOP-WRITEOFF-004-R2\` (Source Type: SOP, Revision: 2, Supersedes: \`SOP-WRITEOFF-004-R1\`, Locator: \`writeoff-approval-limits#3.1\`):
  "Warehouse supervisors may authorize inventory write-offs of damaged stock up to $2,500 per incident without regional manager sign-off."
Compiler Output:
- Requirements:
  - \`REQ-WRITEOFF-CURRENT\` (category: \`business-rule\`, origin: \`EXPLICIT\`, evidence: \`[{"sourceRevisionId": "SOP-WRITEOFF-004-R2", "locator": "writeoff-approval-limits#3.1"}]\`)
- Findings:
  - Emit finding: \`type: "contradiction"\`, \`relatedRequirementKeys: ["REQ-WRITEOFF-CURRENT"]\`, \`evidence: [{"sourceRevisionId": "SOP-WRITEOFF-004-R1", "locator": "writeoff-approval-limits#3.1"}, {"sourceRevisionId": "SOP-WRITEOFF-004-R2", "locator": "writeoff-approval-limits#3.1"}]\`, \`rationale: "Revision 1 permitted warehouse supervisors to authorize write-offs up to $10,000 autonomously, which was subsequently superseded by Revision 2 restricting unescalated supervisor authority to $2,500."\`
Explanation: Genuine supersession conflict where prior revision's authorized threshold contradicts the active superseding revision.

### Example 3: Near-Miss Non-Finding — Distinct Geographically Scoped Thresholds
Sources:
- \`COURIER-POL-002-R1\` (Source Type: POLICY):
  - Locator \`courier-insurance-caps#6.1\`: "For Standard Ground courier dispatches, maximum package liability coverage is capped at $5,000 per shipment."
  - Locator \`courier-insurance-caps#6.2\`: "For Express Air courier dispatches, maximum package liability coverage is capped at $25,000 per shipment."
Compiler Output:
- Requirements:
  - \`REQ-COURIER-GROUND\` (category: \`business-rule\`, statement: "...Standard Ground courier dispatches... maximum package liability coverage is capped at $5,000 per shipment...")
  - \`REQ-COURIER-AIR\` (category: \`business-rule\`, statement: "...Express Air courier dispatches... maximum package liability coverage is capped at $25,000 per shipment...")
- Findings: NONE (\`[]\`).
Explanation: Distinct dollar limits ($5,000 vs $25,000) are explicitly and exhaustively partitioned by named mutually-exclusive delivery tiers (Standard Ground vs Express Air). Because the scopes are separate and non-overlapping, this is NOT a contradiction. Do NOT emit a finding.

### Example 4: Genuine Contradiction — Same-Authority Threshold Conflict
Sources:
- \`SOP-CAPEX-005-R1\` (Source Type: SOP, Locator: \`capex-approval-matrix#1.2\`):
  "Department managers may authorize capital expenditure equipment leases up to $75,000 without Executive Committee approval."
- \`POL-CAPEX-005-R1\` (Source Type: POLICY, Locator: \`capital-expenditure-governance#3.1\`):
  "All capital expenditure commitments, including equipment leases, exceeding $30,000 require formal Executive Committee approval prior to execution."
Compiler Output:
- Requirements:
  - \`REQ-CAPEX-MANAGER\` (category: \`business-rule\`, origin: \`EXPLICIT\`, evidence: \`[{"sourceRevisionId": "SOP-CAPEX-005-R1", "locator": "capex-approval-matrix#1.2"}]\`)
  - \`REQ-CAPEX-DIRECTOR\` (category: \`business-rule\`, origin: \`EXPLICIT\`, evidence: \`[{"sourceRevisionId": "POL-CAPEX-005-R1", "locator": "capital-expenditure-governance#3.1"}]\`)
- Findings:
  - Emit finding: \`type: "contradiction"\`, \`relatedRequirementKeys: ["REQ-CAPEX-MANAGER", "REQ-CAPEX-DIRECTOR"]\`, \`evidence: [{"sourceRevisionId": "SOP-CAPEX-005-R1", "locator": "capex-approval-matrix#1.2"}, {"sourceRevisionId": "POL-CAPEX-005-R1", "locator": "capital-expenditure-governance#3.1"}]\`, \`rationale: "SOP permits department managers to authorize equipment leases up to $75,000 without Executive Committee approval, whereas Policy mandates Executive Committee approval for any lease exceeding $30,000. Both apply to the same expenditure action without an explicit scope partition, creating a direct threshold contradiction for amounts between $30,000 and $75,000."\`
Explanation: Genuine contradiction between two conflicting dollar thresholds applying to the same action/authority without an explicit and exhaustive scope partition. Unlike scoped partitions, these thresholds directly conflict over the same transaction range. Because these requirements define dollar thresholds and approval boundaries, both are classified as \`business-rule\` (not \`actors-permissions\`), and must NOT be split into separate role candidates.

### Example 5: Near-Miss Non-Finding — Paraphrased / Semantically Equivalent Timeframes
Sources:
- \`IT-ONBOARD-003-R1\` (Source Type: SOP, Locator: \`credential-hygiene#4.4\`):
  "System administrators must rotate administrative database credentials every 90 calendar days."
- \`SEC-STD-003-R1\` (Source Type: POLICY, Locator: \`password-policy#2.1\`):
  "For all privileged database accounts, credential rotation is required at least once per 90-day cycle."
Compiler Output:
- Requirements:
  - \`REQ-ROTATION-ONBOARD\` (category: \`actors-permissions\`, statement: "...rotate administrative database credentials every 90 calendar days...")
  - \`REQ-ROTATION-POLICY\` (category: \`actors-permissions\`, statement: "...credential rotation is required at least once per 90-day cycle...")
- Findings: NONE (\`[]\`).
Explanation: "every 90 calendar days" and "at least once per 90-day cycle" express the exact same cadence constraint using different words. They are semantically equivalent paraphrases, NOT a contradiction. Do NOT emit a finding.

### Example 6: Category Classification Contrast — Approval Thresholds (\`business-rule\`) vs. Role Authorization (\`actors-permissions\`)
Sources:
- \`POL-FIN-009-R1\` (Source Type: POLICY, Locator: \`disbursement-controls#1.1\`):
  "Department managers may authorize equipment disbursements up to $50,000; commitments exceeding $50,000 require formal approval from the Chief Financial Officer."
- \`SEC-ACCESS-009-R1\` (Source Type: POLICY, Locator: \`system-roles#3.2\`):
  "Only designated IT Security Officers are authorized to provision privileged administrative database credentials to external contractors."
Compiler Output:
- Requirements:
  - \`REQ-DISBURSEMENT-LIMITS\` (category: \`business-rule\`, origin: \`EXPLICIT\`, evidence: \`[{"sourceRevisionId": "POL-FIN-009-R1", "locator": "disbursement-controls#1.1"}]\`, statement: "Department managers may authorize equipment disbursements up to $50,000; commitments exceeding $50,000 require Chief Financial Officer approval.")
  - \`REQ-PROVISION-AUTHORITY\` (category: \`actors-permissions\`, origin: \`EXPLICIT\`, evidence: \`[{"sourceRevisionId": "SEC-ACCESS-009-R1", "locator": "system-roles#3.2"}]\`, statement: "Only designated IT Security Officers are authorized to provision privileged administrative database credentials to external contractors.")
- Findings: NONE (\`[]\`).
Explanation:
- \`REQ-DISBURSEMENT-LIMITS\` specifies an approval threshold and monetary limit ($50,000) governing authorization. Even though it names roles (department managers, Chief Financial Officer), it is classified as \`business-rule\` and kept as a single unified requirement rather than split into multiple categories.
- \`REQ-PROVISION-AUTHORITY\` specifies role-based privileges and access boundaries without a numeric or monetary threshold, so it is classified as \`actors-permissions\`.

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
2. Allowed origins: ${CANDIDATE_REQUIREMENT_ORIGINS.join(', ')}.
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
    evidence: readonly CandidateEvidenceRefDto[],
    allowedSourceRevisionIds: ReadonlySet<string>
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

      if (!allowedSourceRevisionIds.has(ref.sourceRevisionId)) {
        return {
          ok: false,
          error: new UnknownSourceRevisionError(
            ref.sourceRevisionId,
            `Source revision '${ref.sourceRevisionId}' is outside the compile scope`
          )
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
