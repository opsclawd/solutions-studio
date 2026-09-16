# Product Requirements Document (PRD)

**Product Name:** Evidence-to-Implementation-Ready Requirements Engine ("Solutions Studio")  
**Document Version:** 1.4-MVP  
**Status:** Ready for Engineering Review  
**Target Architecture:** Enterprise Cloud / Private Azure Environment  
**Target Users:** Business Solutions Developers, Business Analysts, Solutions Architects, Business SMEs

## 1. Executive Summary & Problem Statement

### 1.1 The Problem

In enterprise IT, discovery and requirements gathering remain primary bottlenecks:

- **Abstract Communication:** Business SMEs communicate in terms of operational friction, physical forms, spreadsheets, policies, and exceptions. IT frequently answers with text-heavy requirement documents that stakeholders struggle to validate in concrete terms.
- **Delayed Feedback Loops:** Missing operational edge cases, unstated field dependencies, contradictory rules, authorization gaps, and invalid approval chains are often discovered only during implementation, user acceptance testing (UAT), or after release.
- **Requirements Without Durable Provenance:** User stories may be clear in isolation while still encoding unsupported assumptions, conflicting source material, or product decisions that were never explicitly made. Mutable source documents can also make citations ambiguous after edits.
- **Downstream Automation Amplifies Input Quality:** As software delivery becomes increasingly automated, an implementation pipeline can faithfully and efficiently build the wrong behavior when the issue entering the pipeline is incomplete or incorrect.
- **Proliferation of Shadow IT:** Faced with long discovery backlogs, operational teams build unvetted Excel macros, Access databases, and ungoverned low-code apps that lack enterprise auth, backup pipelines, or cybersecurity oversight.

### 1.2 The Solution

**Solutions Studio** is an internal, privacy-isolated AI workspace that acts as a specialized **requirements compiler** for business analysis. It ingests standardized Markdown summaries of SME interviews, standard operating procedures (SOPs), legacy schemas, policy constraints, and spreadsheet-derived observations; extracts atomic candidate requirements with immutable source provenance; surfaces conflicts and missing boundaries; supports explicit human resolution; and establishes an immutable verified requirements baseline before generating downstream artifacts.

From that baseline, Solutions Studio can generate:

1. **Sandboxed, interactive form/UI prototypes** for stakeholder validation.
2. **Deterministically syntax-validated Mermaid.js process, state, and entity-relationship diagrams**.
3. **Normalized SQL DDL relational schemas and OpenAPI contracts**.
4. **Traceable, Gherkin-formatted user stories and acceptance criteria**.
5. **Story-readiness reports and dependency metadata** suitable for downstream automated SDLC execution.

The core product contract is not "Markdown in, artifacts out." It is:

```text
Evidence
  -> immutable source revisions
  -> candidate requirements / findings
  -> canonical requirement revisions
  -> conflict / ambiguity / coverage resolution
  -> immutable verified requirements baseline
  -> generated validation artifacts
  -> implementation-ready stories
  -> governed backlog export
```

Generated artifacts are **projections of the verified requirements baseline**, not independent sources of business truth. A prototype, schema, diagram, or generated story may expose a missing requirement, but it cannot silently create authoritative business behavior.

The Markdown-first MVP avoids fragile multimodal ingestion and retrieval chunking while preserving stable source addressing. Full-context loading reduces retrieval-loss failure modes but does not imply perfect model recall. Requirement extraction and defect discovery remain probabilistic; provenance, revision integrity, finding disposition, coverage, and readiness enforcement are deterministic once their structured inputs exist.

## 2. Product Goals & Non-Goals

### 2.1 Strategic Goals

- **Compress Discovery Timelines:** Reduce the cycle from initial SME discovery to a validated requirements baseline and interactive validation artifacts from weeks to days for suitable workflows.
- **Durable Traceable Grounding:** Ensure every accepted normative requirement revision is linked to immutable source evidence or an explicitly accepted assumption/proposal.
- **Requirements Reconciliation:** Surface contradictions, missing boundaries, incomplete state machines, undefined authorization, unhandled failure behavior, cardinality gaps, and unresolved product decisions before backlog export.
- **Story Readiness:** Prevent stories from entering downstream engineering when implementation would still require the implementer to make product decisions.
- **Artifact Cross-Validation:** Use prototypes, process diagrams, data models, API contracts, and stories as alternate representations that test the same requirements baseline for gaps and inconsistencies.
- **Trust Through Evaluation:** Maintain an adversarial evaluation corpus with planted defects and near-conflicts so the quality of requirement extraction and finding discovery can be measured rather than assumed.
- **Self-Healing Syntax:** Enforce automated parser/linter loops that self-correct invalid generated syntax before presenting artifacts to users.
- **Governed Golden Paths:** Apply enterprise policy constraints such as identity, security, auditability, architecture, and compliance without misrepresenting them as SME-authored business requirements.
- **Provider Independence:** Keep generation orchestration independent from any specific model vendor, API, CLI, or agent runtime so generation backends can be replaced without changing domain or application business rules.

### 2.2 Non-Goals (Explicitly Out of Scope for MVP)

- **Direct Multi-File Native Ingestion:** No direct PDF OCR, raw Excel parsing, or raw audio transcription in v1.0. Inputs must first be converted into the standardized Markdown schema.
- **Autonomous Product Authority:** The model may extract, infer, propose, and flag candidate requirements, but it may not silently resolve material business conflicts or grant business authority.
- **Deterministic Discovery Claims:** The system does not claim that an LLM will deterministically discover every contradiction, ambiguity, missing authorization rule, or omitted requirement. Detection quality must be evaluated empirically.
- **Generated Artifact Authority:** Wireframes, schemas, diagrams, and stories do not become authoritative simply because they were generated or accepted syntactically. New business behavior discovered through an artifact must return to the requirements model for explicit resolution.
- **Conflating Business and Engineering Authority:** Legitimate engineering choices do not require fabricated SME provenance. Engineering decisions are recorded separately from business requirements and enterprise policy constraints.
- **Autonomous Production Code Deployment:** The tool produces validated requirements packages, prototypes, specifications, and scaffolding; it does not autonomously push production code to live environments.
- **Unapproved Generation Provider Exposure:** Production enterprise context may only be transmitted through generation adapters and underlying providers approved for the deployment environment. Phase 0 tracer spikes may use developer-configured CLI adapters only with synthetic/non-sensitive fixtures unless the configured provider is enterprise-approved.

## 3. User Personas & Workflows

| Persona                                   | Role                           | Core Value Received                                                                                                                                    |
| ----------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Business Solutions Developer / BA**     | Primary Operator               | Converts discovery evidence into reconciled requirement revisions, drives stakeholder resolution, and exports implementation-ready work.               |
| **Business SME (Ops, Field, Compliance)** | Collaborator & Validator       | Validates concrete process flows, rules, exceptions, UI behavior, and unresolved questions instead of reviewing only abstract prose.                   |
| **Enterprise Architect / Lead Dev**       | Policy & Engineering Authority | Supplies or applies enterprise constraints and records engineering decisions without contaminating business-requirement provenance.                    |
| **Automated SDLC / Engineering Team**     | Downstream Executor            | Receives stories that define product behavior clearly enough that implementation can focus on engineering decisions rather than requirement invention. |

### 3.1 Primary MVP User Journey

```text
[SME Interview / SOPs / Policies / Spreadsheets / Legacy Rules]
                │
                ▼ (Human normalization pass)
   Standardized Source Markdown (.md)
                │
                ▼ save/import
       [Immutable SourceRevision]
                │
                ▼
       [Requirements Compilation]
 Candidate requirements + candidate findings
                │
                ▼
    [Canonical Requirement Revisions]
 origin + review state + resolution state + evidence
                │
                ▼
       [Requirements Review Loop]
 Resolve conflicts / assumptions / open product decisions
                │
                ▼
    [Immutable Requirements Baseline]
                │
      ┌─────────┼──────────┬──────────┬──────────┐
      ▼         ▼          ▼          ▼          ▼
 Prototype   Process     Schema      API       Stories
             / State      / ERD    Contract   / Gherkin
      └─────────┼──────────┴──────────┴──────────┘
                ▼
       [Cross-Validation Findings]
                │
                ├──► unresolved -> requirements review loop
                │
                ▼
        [Story Readiness Gate]
                │
                ▼
 [Jira / Azure DevOps / GitHub Export]
                │
                ▼
          [Downstream SDLC]
```

## 4. Architectural & System Design

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                        INTERFACE / PRESENTATION LAYER                       │
│  - Next.js (App Router) + Tailwind CSS + Monaco Code Editor                 │
│  - Requirements review / conflict resolution UI                            │
│  - Evaluation reports and readiness reports                                │
│  - Interactive Sandboxed <iframe> Runtime                                  │
│  - Fastify HTTP Controllers, SSE Streaming Handlers, Zod Payload Parsers    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                      │ calls
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                           APPLICATION LAYER                                 │
│  - CompileRequirementsUseCase                                               │
│  - ReconcileRequirementsUseCase                                             │
│  - CreateRequirementsBaselineUseCase                                        │
│  - EvaluateRequirementsCompilerUseCase                                      │
│  - GenerateArtifactUseCase                                                  │
│  - ValidateStoryReadinessUseCase                                            │
│  - ExportToBacklogUseCase                                                   │
│                                                                             │
│  Ports: IGenerationGateway, validation gateways, repositories, export ports │
└───────────────────┬─────────────────────────────────────┬───────────────────┘
                    │ uses                                │ implemented by
┌───────────────────▼──────────────────────┐ ┌───────────▼───────────────────┐
│             DOMAIN LAYER                │ │     INFRASTRUCTURE LAYER     │
│  - Source / SourceRevision              │ │ - AntigravityCliAdapter      │
│  - Requirement / RequirementRevision    │ │ - OpenCodeCliAdapter         │
│  - PolicyConstraint / revision          │ │ - MermaidCliLinterAdapter    │
│  - EngineeringDecision                  │ │ - BabelAstLinterAdapter      │
│  - RequirementsBaseline                 │ │ - PGliteSchemaLinterAdapter  │
│  - CandidateFinding / disposition       │ │ - BetterSqliteRepository     │
│  - Story / StoryReadiness               │ │ - Backlog export adapters    │
│  - Provenance / coverage invariants     │ │                              │
└──────────────────────────────────────────┘ └───────────────────────────────┘
```

### 4.1 Monorepo Structure & Clean Separation

The system is structured as a TypeScript monorepo to enforce architectural boundaries while keeping domain business rules independent from transport validation and infrastructure libraries:

- `packages/domain`: Domain entities, value objects, domain services, invariants, and domain errors. This package has **zero external runtime dependencies** and contains no framework, persistence, transport, UI, parser, or generation-provider concerns.
- `packages/contracts`: Shared application/API DTOs, Zod validation schemas, artifact serialization formats, evaluation-fixture schemas, and command/event contracts. Boundary validation may live here; domain business rules may not.
- `apps/orchestrator`: Fastify backend implementing Application use cases and Infrastructure adapters.
- `apps/web`: Next.js frontend hosting source editing, requirements review/resolution, evaluation reports, readiness reports, artifact previews, and the sandboxed prototype iframe.

**Validation Boundary Rule:** Structural and transport validation belongs at system boundaries. Business validity belongs in `packages/domain`.

**Syntax vs. Domain Validation:** Parser-backed syntax checks are infrastructure concerns. A Gherkin parser can prove syntax validity; the domain decides whether a story references accepted requirement revisions, has no blocking unresolved findings, and satisfies the configured readiness policy.

### 4.2 Generation Gateway & CLI Adapter Boundary

The Application layer depends on a capability-oriented `IGenerationGateway`, not on an LLM vendor, model API, or specific CLI:

```ts
interface IGenerationGateway {
  generate(request: GenerationRequest): Promise<GenerationResult>;
}
```

- **Initial adapters:** `AntigravityCliAdapter` (`agy`) and `OpenCodeCliAdapter` (`opencode`). Provider selection is configuration-driven and must not alter application orchestration code.
- **Normalized execution contract:** CLI-specific output formats, exit codes, authentication failures, timeouts, conversation/session identifiers, and model metadata are normalized by the adapter.
- **Application-owned repair loop:** Artifact-specific repair is not a gateway responsibility. The application constructs repair requests, invokes generation, runs deterministic validators, and controls retry/exhaustion policy.
- **Text-generation mode:** Generation CLIs are invoked in a constrained, non-interactive mode with optional agent tooling disabled or restricted. Solutions Studio owns workflow and lifecycle state.
- **Deterministic testing:** A fake generation gateway must support automated orchestration and evaluation tests without invoking a real CLI.

### 4.3 Source Evidence & Immutable Revision Semantics

Markdown is the evidence transport for the MVP. A mutable Markdown file is an editing surface, **not** a durable provenance target.

Each logical source has a stable identity:

```ts
type Source = {
  id: SourceId; // e.g. INT-004
  sourceType: 'interview' | 'sop' | 'policy' | 'schema' | 'spreadsheet';
};
```

Every imported or saved evidence state creates an immutable source revision:

```ts
type SourceRevision = {
  id: SourceRevisionId; // e.g. INT-004@r3
  sourceId: SourceId;
  revision: number;
  contentHash: string;
  capturedAt: Instant;
  verifiedAt?: Instant;
  supersedes?: SourceRevisionId;
};
```

Evidence references must point to a specific source revision plus a stable locator within that revision:

```ts
type EvidenceReference = {
  sourceRevisionId: SourceRevisionId;
  locator: string; // e.g. business-logic-1 or section-7.3
};
```

A reference such as `INT-004#business-logic-1` without revision identity is insufficient for accepted downstream provenance.

The standardized Markdown remains human-editable:

```md
---
workspace_id: 'WS-OPS-001'
source_id: 'INT-004'
title: 'Secondary Line Inspection & Valve Verification'
source_type: 'interview'
stakeholders: ['D. Smith (Field Lead)', 'M. Johnson (Compliance Inspector)']
date: 2026-09-15
---

# Scope & Objective

...

# Business Logic & Operational Rules

1. If `valve_pressure_psi` exceeds 800.0, require secondary sign-off from Supervisor.

# Ambiguities & Open Questions

- [ ] What is the escalation path if Supervisor approval exceeds 4 hours?
```

The system assigns revision identity and content hashes when the source is captured. Editing the source creates a new `SourceRevision`; historical evidence references remain bound to the old immutable revision.

### 4.4 Authority Ontology: Business Requirements, Policy Constraints, Engineering Decisions

Solutions Studio shall not flatten all normative or technical statements into one business-requirement model.

| Ontology                | Authority                                             | Examples                                                                             | Provenance expectation                                                             |
| ----------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| **BusinessRequirement** | SME/product/business authority                        | approval thresholds, allowed user actions, workflow outcomes                         | Business evidence or explicit accepted product decision                            |
| **PolicyConstraint**    | Enterprise architecture/security/compliance authority | Entra ID requirement, encryption rule, audit retention, approved integration pattern | Immutable policy source or explicit policy decision                                |
| **EngineeringDecision** | Engineering/architecture authority                    | optimistic locking, index strategy, module boundaries, cache strategy                | Rationale plus input requirement/policy references; SME provenance is not required |

Generated schemas, APIs, architecture, and implementation plans may contain legitimate `EngineeringDecision` records. They must not fabricate business provenance for those choices.

A downstream story may be constrained by both accepted business requirements and applicable policy constraints. Engineering decisions may be deferred to the SDLC implementation phase when they do not alter product behavior or violate policy.

### 4.5 Canonical Requirement Identity, Revisions, and Independent State Dimensions

A logical requirement has a stable identity. Its meaning is represented by immutable revisions.

```ts
type Requirement = {
  id: RequirementId; // stable identity, e.g. R-142
};

type RequirementRevision = {
  id: RequirementRevisionId; // e.g. R-142@r4
  requirementId: RequirementId;
  revision: number;
  statement: string;
  category: RequirementCategory;
  origin: RequirementOrigin;
  reviewState: RequirementReviewState;
  resolutionState: RequirementResolutionState;
  evidence: EvidenceReference[];
  rationale?: string;
  affectedActors?: ActorId[];
  dependencies?: RequirementId[];
  supersedes?: RequirementRevisionId;
};
```

`origin`, `reviewState`, and `resolutionState` are deliberately independent dimensions. They must not be collapsed into one mutually exclusive `RequirementStatus` enum.

#### 4.5.1 Origin

| Origin               | Meaning                                                                |
| -------------------- | ---------------------------------------------------------------------- |
| `EXPLICIT`           | Directly stated in source evidence.                                    |
| `INFERRED`           | Derived from evidence but not directly stated.                         |
| `ASSUMED`            | Introduced because progress requires an unstated product assumption.   |
| `GENERATED_PROPOSAL` | Proposed by the system during extraction or artifact cross-validation. |
| `REVIEWER_PROPOSAL`  | Proposed manually by a reviewer during reconciliation.                 |

An accepted assumption remains `origin=ASSUMED`; acceptance does not erase its origin.

#### 4.5.2 Review State

| Review State | Meaning                                                                     |
| ------------ | --------------------------------------------------------------------------- |
| `PENDING`    | Has not received required authority.                                        |
| `ACCEPTED`   | Accepted by the appropriate business/product authority.                     |
| `REJECTED`   | Explicitly rejected; retained for audit but excluded from active baselines. |

#### 4.5.3 Resolution State

| Resolution State | Meaning                                                                           |
| ---------------- | --------------------------------------------------------------------------------- |
| `CLEAR`          | No known material conflict or unanswered blocking question affects this revision. |
| `CONFLICTED`     | Credible evidence or accepted requirements materially disagree.                   |
| `UNRESOLVED`     | A known unanswered question materially affects meaning or implementation.         |
| `SUPERSEDED`     | A newer requirement revision has replaced this revision.                          |

An inferred requirement can therefore be `origin=INFERRED`, `reviewState=ACCEPTED`, and `resolutionState=CLEAR`. A business-approved assumption can be `origin=ASSUMED`, `reviewState=ACCEPTED`, and `resolutionState=CLEAR`.

### 4.6 Immutable Requirements Baselines

A verified baseline is an immutable manifest of exact accepted revisions, not a pointer to "latest" mutable requirements.

```ts
type RequirementsBaseline = {
  id: RequirementsBaselineId; // e.g. BASELINE-17
  requirementRevisions: RequirementRevisionId[];
  policyConstraintRevisions: PolicyConstraintRevisionId[];
  createdAt: Instant;
  createdBy: ReviewerId;
};
```

A requirement revision may enter a verified baseline only when:

- `reviewState=ACCEPTED`;
- `resolutionState=CLEAR`;
- required evidence or an explicit accepted assumption/proposal is present;
- no blocking open finding prevents inclusion under configured policy.

When evidence or requirement meaning changes, the system creates new revisions and a new baseline. Existing stories, exports, tests, and downstream issues remain traceable to the baseline against which they were compiled and can be identified as stale when a newer baseline supersedes relevant inputs.

### 4.7 Probabilistic Discovery vs. Deterministic Enforcement

Solutions Studio shall explicitly separate model-assisted discovery from deterministic control-plane rules.

**Probabilistic/model-assisted operations include:**

- extracting candidate requirements from source text;
- proposing inferred requirements;
- discovering candidate contradictions, missing authorization, state gaps, temporal ambiguity, or cardinality ambiguity;
- generating candidate stories and artifacts;
- suggesting requirement decompositions or engineering decisions.

These operations may miss defects or produce false positives. Their quality must be evaluated against fixtures and human-reviewed real cases.

**Deterministic operations include:**

- source and requirement revision identity;
- content hashing and immutable provenance links;
- schema/structural validation;
- requirement-to-story relationship coverage counts;
- baseline membership rules;
- finding-disposition requirements;
- configured Definition-of-Ready checks over structured state;
- parser/linter validation;
- export policy enforcement.

The system may deterministically enforce that all **known** blocking findings are resolved before export. It must not claim that a passing gate proves no undiscovered defect exists.

### 4.8 Candidate Findings and Reconciliation

Model or heuristic discovery produces structured candidate findings rather than directly mutating requirement authority:

```ts
type CandidateFinding = {
  id: FindingId;
  type: FindingType;
  affectedRequirementRevisions: RequirementRevisionId[];
  evidence: EvidenceReference[];
  discoveredBy: 'model' | 'heuristic' | 'artifact-validation' | 'human';
  disposition: FindingDisposition;
  rationale?: string;
};

type FindingDisposition = 'OPEN' | 'RESOLVED' | 'DISMISSED_FALSE_POSITIVE' | 'ACCEPTED_RISK';
```

Finding types include, at minimum:

- contradictory thresholds, states, permissions, or outcomes;
- missing authorization boundaries;
- incomplete state machines;
- missing failure/recovery behavior;
- undefined cardinality;
- temporal ambiguity;
- data-boundary ambiguity;
- unsupported assumptions;
- subjective/unmeasurable normative language.

Configured domain policy determines which open finding types block baseline creation or implementation-ready export. Resolution and dismissal require an auditable rationale.

### 4.9 Provenance and Traceability

Every normative business requirement or policy constraint exported downstream must preserve provenance to exact immutable source revisions or an explicit authority decision.

Example:

```text
RequirementRevision R-142@r4
  Statement:
    Inspections above 800 PSI require supervisor approval.

  Origin:
    EXPLICIT

  ReviewState:
    ACCEPTED

  ResolutionState:
    CLEAR

  Evidence:
    INT-004@r3#business-logic-1
    SOP-018@r7#section-7.3

  Baseline:
    BASELINE-17

  Derived artifacts:
    STORY-31@BASELINE-17
    PROCESS-4@BASELINE-17
    SCHEMA-CONSTRAINT-12@BASELINE-17
```

The system must support both directions of traceability:

```text
source revision -> requirement revision -> artifact/story -> downstream work item
requirement revision -> covering stories / artifacts / exports
```

### 4.10 Requirements Quality & Coverage Model

Coverage must be computed from explicit identifiers and relationships rather than from a model assertion.

```text
Accepted requirement revisions in BASELINE-17: 87
Covered by implementation-ready stories: 82
Explicitly excluded from current scope: 3
Uncovered: 2

Coverage status: FAIL
Uncovered: R-41@r2, R-73@r1
```

Coverage proves relationship completeness for known baseline requirements. It does not prove that the extraction phase discovered every real-world requirement.

## 5. Functional Requirements (Features)

### FR-1: Workspace, Evidence & Revision Management

- **FR-1.1:** The system shall support project-based workspaces containing standardized source Markdown and generated/derived artifacts.
- **FR-1.2:** Context windows shall support up to 100,000 tokens of curated Markdown text per workspace using direct full-context loading into the configured generation runtime.
- **FR-1.3:** The workspace interface shall provide a Markdown editor allowing the BA to edit, format, and save source material.
- **FR-1.4:** Each logical source shall have a stable `SourceId`.
- **FR-1.5:** Each saved/imported source state used for provenance shall create an immutable `SourceRevision` with revision number and content hash.
- **FR-1.6:** Evidence references shall bind to exact `SourceRevisionId` plus locator; mutable source IDs alone are insufficient for accepted provenance.
- **FR-1.7:** Historical source revisions referenced by accepted baselines or exports shall remain addressable for audit.
- **FR-1.8:** Phase 1 shall persist `SourceRevision`, `RequirementRevision`, `CandidateFinding`, `RequirementsBaseline`, reconciliation/audit records, and evaluation fixtures/results using the minimum local SQLite/filesystem storage required to prove the kernel across process restarts. Production storage hardening is not required in Phase 1.

### FR-2: Requirements Compilation & Reconciliation

- **FR-2.1:** The engine shall extract candidate atomic requirements from active workspace evidence.
- **FR-2.2:** Extraction shall classify requirements across actors/permissions, business rules, lifecycle/state, data constraints, integrations, failure behavior, exceptions, and NFRs where present.
- **FR-2.3:** Each requirement revision shall record independent `origin`, `reviewState`, and `resolutionState` dimensions.
- **FR-2.4:** The system shall create structured candidate findings for detected contradictions and implementation-relevant gaps rather than autonomously resolving business authority.
- **FR-2.5:** Reviewers shall be able to accept, reject, revise, resolve, dismiss false-positive findings, or explicitly accept assumptions while preserving an auditable history.
- **FR-2.6:** Editing the meaning of an accepted requirement shall create a new immutable `RequirementRevision`; it shall not mutate a revision referenced by an existing baseline.
- **FR-2.7:** The system shall establish immutable versioned `RequirementsBaseline` manifests containing exact accepted requirement and applicable policy-constraint revisions.
- **FR-2.8:** The system shall distinguish `BusinessRequirement`, `PolicyConstraint`, and `EngineeringDecision` authority and provenance.

### FR-3: Requirements Intelligence Evaluation Harness

- **FR-3.1:** Phase 1 shall include a permanent evaluation corpus for requirement extraction and finding discovery.
- **FR-3.2:** Evaluation fixtures shall include planted examples of:
  - contradictory approval thresholds;
  - missing actors/authorization;
  - incomplete state transitions;
  - missing failure/recovery behavior;
  - temporal ambiguity;
  - undefined cardinality;
  - unsupported assumptions;
  - superseded source/requirement revisions;
  - source-authority conflicts;
  - false-positive near-conflicts that must **not** be reported as contradictions.
- **FR-3.3:** Each fixture shall define expected extracted requirements, expected findings, expected non-findings, and relevant provenance relationships where practical.
- **FR-3.4:** The harness shall report detection quality by finding category, including misses and false positives; a single aggregate pass/fail rate is insufficient.
- **FR-3.5:** Provider/model changes to requirements intelligence shall be evaluated against the same corpus before promotion.
- **FR-3.6:** Initial Phase 1 work shall establish empirical baselines before hard production thresholds are chosen; thresholds must be based on observed evaluation performance rather than invented targets.

### FR-4: Interactive Wireframe & Prototype Engine

- **FR-4.1:** Upon prompt (`/wireframe [workflow]`), the engine shall generate executable, single-file React components or another approved constrained representation from an immutable active requirements baseline.
- **FR-4.2:** The frontend shall execute generated dynamic code inside an isolated, sandboxed `<iframe>` using the approved compilation/runtime contract.
- **FR-4.3:** The UI sandbox shall simulate accepted state transitions, authorization-sensitive behavior, validation states, and relevant error conditions.
- **FR-4.4:** Prototype behavior that is not traceable to the current baseline or a recorded engineering decision must be surfaced as a candidate finding/proposal rather than silently accepted as authoritative business behavior.
- **FR-4.5:** Stakeholder discoveries during prototype review shall be promotable back into the requirements review workflow as new candidate requirement revisions.

### FR-5: Visual Process & Architecture Engine

- **FR-5.1:** Upon prompt (`/process`, `/state`, or `/erd`), the engine shall output valid Mermaid.js syntax using a specific requirements baseline.
- **FR-5.2:** The system shall render diagrams within an interactive SVG viewport supporting zoom, pan, and SVG export.
- **FR-5.3 (Closed-Loop Syntax Repair):** The backend shall execute a headless syntax pass; invalid syntax may receive up to 2 automated repair cycles before returning a typed validation failure.
- **FR-5.4:** Diagram generation/review shall be able to emit structured findings such as unreachable states, missing terminal paths, or approval flows lacking accepted requirements.

### FR-6: Data Contract & Relational Schema Engine

- **FR-6.1:** Upon prompt (`/schema [dialect]`), the engine shall generate normalized SQL DDL scripts supporting PostgreSQL and Microsoft Azure SQL / T-SQL from accepted business requirements, policy constraints, and recorded engineering decisions.
- **FR-6.2:** Generated schemas shall enforce applicable primary/foreign key constraints, relevant indexes, uniqueness/cardinality rules, and audit/history semantics.
- **FR-6.3:** Upon prompt (`/api`), the engine shall generate valid OpenAPI 3.1 specifications defining request/response shapes, parameter constraints, authorization-relevant contract behavior, and applicable HTTP status/error semantics.
- **FR-6.4:** Schema/API generation may propose legitimate engineering decisions. Such decisions shall be recorded separately with rationale and input references rather than being promoted as business requirements.
- **FR-6.5:** Missing product behavior surfaced during contract generation shall return to requirements reconciliation as candidate findings/proposals.

### FR-7: User Story, Acceptance Criteria & Readiness Engine

- **FR-7.1:** Upon prompt (`/stories`), the engine shall generate user stories following standard Agile structure: _As a [Role], I want [Feature], so that [Business Outcome]_.
- **FR-7.2:** Acceptance criteria shall be formatted in strict Gherkin BDD syntax (`Scenario:`, `Given`, `When`, `Then`).
- **FR-7.3 (Requirement Traceability):** Every normative story clause shall reference exact accepted `RequirementRevisionId` values and the `RequirementsBaselineId` against which the story was compiled.
- **FR-7.4 (Policy Traceability):** Applicable enterprise policy constraints shall be referenced separately from business requirements.
- **FR-7.5 (Behavioral Completeness):** Story generation shall include relevant negative paths, failure behavior, authorization boundaries, state transitions, and data constraints when those behaviors are present in covered requirement revisions.
- **FR-7.6 (Definition of Ready):** A story shall not be marked implementation-ready unless, where applicable:
  - the business outcome is identified;
  - actor and authorization boundaries are explicit;
  - scope and exclusions are explicit;
  - acceptance criteria are testable;
  - happy path and relevant negative paths are covered;
  - state transitions are covered;
  - data constraints are covered;
  - failure/recovery behavior is specified;
  - applicable NFRs and policy constraints are attached;
  - dependencies are identified;
  - every normative clause maps to accepted requirement revisions in the referenced baseline;
  - no known open blocking finding materially affects implementation;
  - no unresolved ambiguity requires an implementer to make a product decision;
  - required assumptions have `reviewState=ACCEPTED` and `resolutionState=CLEAR`.
- **FR-7.7 (Coverage Gate):** The system shall report accepted baseline requirement revisions that are uncovered or explicitly excluded before backlog export.
- **FR-7.8 (Dependency Graph):** The system shall produce machine-readable story dependency metadata suitable for sequencing downstream work.
- **FR-7.9:** Engineering decisions that can safely be deferred to downstream implementation shall not be treated as missing product requirements solely because they are unspecified in business evidence.

### FR-8: Artifact Handoff & Export

- **FR-8.1:** Users shall be able to export artifacts as raw Markdown, clean SQL, SVG diagrams, approved prototype source/representation, and structured requirement/story manifests.
- **FR-8.2:** Export payloads for Jira, Azure DevOps, and/or GitHub shall include story text, acceptance criteria, `RequirementsBaselineId`, exact requirement revision references, readiness status, and dependency metadata.
- **FR-8.3:** Only stories that pass configured readiness policy may be exported as `implementation-ready`; incomplete work may be exported only with an explicit non-ready status.
- **FR-8.4:** Export manifests shall preserve enough identity to determine whether a downstream item is stale when a relevant requirement revision or baseline changes.
- **FR-8.5:** Export identifiers shall support future traceability from source revision through requirement revision, baseline, story, downstream issue, implementation, test, and PR.

## 6. Non-Functional Requirements (NFRs)

### 6.1 Security & Data Sovereignty

- **NFR-1.1 (Generation Data Boundary):** Enterprise context, transcripts, and generated specifications may only be transmitted through explicitly configured generation adapters whose underlying provider/runtime is approved for the deployment environment.
- **NFR-1.2 (Identity & Access):** The platform shall integrate with Microsoft Entra ID (Azure AD) via OAuth 2.0 / OpenID Connect with PKCE.
- **NFR-1.3 (Client Isolation):** Dynamic UI code generated by the generation runtime must execute exclusively within sandboxed `<iframe>` environments with restricted sandbox attributes and a restrictive Content Security Policy.
- **NFR-1.4 (Generation Runtime Isolation):** CLI generation adapters must run with only the capabilities required for generation and must not implicitly receive unrelated workspace or environment access.
- **NFR-1.5 (Auditability):** Source revisions, requirement revisions, review decisions, conflict resolutions, finding dispositions, accepted assumptions, baseline manifests, and readiness decisions must be auditable.

### 6.2 Reliability, Quality & Performance

- **NFR-2.1 (Generation Latency):** Latency targets are experience goals rather than authority/quality gates. Validation, provenance, reconciliation, and readiness checks take precedence.
- **NFR-2.2 (Syntax Success Rate):** Automated self-healing loops should ensure > 98% of rendered Mermaid and approved dynamic prototype artifacts load without rendering exceptions on first presentation after repair processing.
- **NFR-2.3 (Provider Substitutability):** Switching generation adapters must not require changes to domain authority rules, revision semantics, readiness rules, artifact validators, or API contracts.
- **NFR-2.4 (Provenance Completeness):** The system shall reject implementation-ready export when any normative story clause lacks an accepted requirement-revision mapping.
- **NFR-2.5 (Coverage Determinism):** Requirement-to-story coverage shall be computed from identifiers/relationships rather than LLM self-assessment.
- **NFR-2.6 (Revision Integrity):** A baseline or export must never silently retarget to a newer source or requirement revision.
- **NFR-2.7 (Evaluation Repeatability):** Requirements-intelligence evaluation fixtures, expected findings, and reported results must be versioned so model/provider changes can be compared against the same corpus.
- **NFR-2.8 (Phase 1 Persistence):** The minimum requirements kernel must survive process restarts without losing immutable revisions, finding dispositions, baseline identity, reconciliation history, or evaluation results. Enterprise durability, backup/recovery, retention, concurrency, and migration requirements are deferred to production persistence hardening.

## 7. Recommended Technical Stack (MVP)

| Component              | Selected Technology                                                                                                  | Architectural Rationale                                                                                                                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend Framework** | **Next.js (App Router) + React, Tailwind CSS**                                                                       | Requirements review, split-pane editing, evaluation/readiness reports, artifact previews, and sandbox hosting.                                                                                                                               |
| **Editor & Viewers**   | **Monaco Editor**, `@mermaid-js/mermaid`, `@tanstack/react-table`                                                    | Source editing, visual diagramming, requirements/conflict tables, and readiness inspection.                                                                                                                                                  |
| **Prototype Sandbox**  | **Sandboxed iframe + `@babel/standalone`**                                                                           | In-browser execution of constrained generated React TSX under the Phase 0 isolation contract.                                                                                                                                                |
| **Backend API**        | **Node.js (TypeScript) with Fastify**                                                                                | Type-sharing, asynchronous orchestration, and lightweight application services.                                                                                                                                                              |
| **Validation Linters** | `@mermaid-js/mermaid-cli`, `zod`, Gherkin parser, `sqlfluff` / `@electric-sql/pglite`                                | Deterministic syntax/structure validation surrounding probabilistic generation.                                                                                                                                                              |
| **Persistence**        | **Phase 1: SQLite + local filesystem. Phase 4: Azure Blob / approved enterprise storage and operational hardening.** | Phase 1 needs durable local state to prove immutable revisions, findings, baselines, reconciliation, and evaluation. Production retention, backup/recovery, concurrency, migrations, lifecycle, and operations are deferred until hardening. |
| **Generation Runtime** | **Provider-agnostic CLI adapters; initial implementations: Antigravity (`agy`) and OpenCode (`opencode`)**           | Preserves model/provider portability behind `IGenerationGateway`.                                                                                                                                                                            |

## 8. Delivery Plan: Vertical Slice Roadmap

Phase 0 implementations are **mergeable tracer implementations**, not disposable prototypes. They establish reusable seams, tests, fixtures, typed failures, and documented findings that carry forward.

```text
Phase 0: Technical De-Risking (completed/existing tracer work)
├── Spike A: Provider-Agnostic Generation + Closed-Loop Mermaid Repair
│   ├── IGenerationGateway + deterministic fake
│   ├── AntigravityCliAdapter + OpenCodeCliAdapter
│   ├── Typed gateway failures
│   └── Invalid Mermaid -> validate -> repair -> revalidate within <= 2 attempts
└── Spike B: Sandboxed <iframe> execution of generated React/Tailwind
    ├── Demonstrate state transitions and validation behavior
    ├── Prevent child access to parent DOM/storage
    └── Enforce restrictive CSP for outbound network access

Phase 1: Vertical Slice 1 — Minimum Requirements Kernel + Evaluation
├── Implement only the kernel needed to prove requirements compilation
│   ├── immutable SourceRevision + content hash
│   ├── immutable RequirementRevision
│   ├── EvidenceReference
│   ├── independent origin / reviewState / resolutionState
│   ├── generic CandidateFinding + auditable disposition
│   └── immutable RequirementsBaseline manifest
├── Add minimal local persistence using SQLite/local filesystem
│   ├── SourceRevision / RequirementRevision
│   ├── CandidateFinding + disposition / reconciliation audit
│   ├── RequirementsBaseline
│   └── evaluation fixtures and results
├── Implement atomic candidate-requirement extraction
├── Implement provenance validation against exact SourceRevision IDs
├── Implement human reconciliation and finding disposition
├── Build adversarial requirements-intelligence evaluation corpus
│   ├── planted contradictions
│   ├── missing actors / authorization
│   ├── state-transition gaps
│   ├── temporal / cardinality ambiguity
│   ├── unsupported assumptions
│   ├── supersession / source-authority cases
│   └── false-positive near-conflicts
├── Establish empirical evaluation baseline by finding category
├── Freeze an immutable verified requirements baseline
└── Generate at least one consistent baseline projection using existing Phase 0 capability

Phase 1 intentionally does NOT require full implementation of richer PolicyConstraint behavior,
EngineeringDecision workflows, downstream stale-item propagation, impact analysis, story readiness,
dependency orchestration, enterprise storage, retention, backup/recovery, concurrency, migrations,
or other production persistence hardening. Those concepts remain part of the destination architecture
and are implemented when later slices create concrete demand for them.

Phase 1 exit criterion:
Given a deliberately messy discovery package, the system can persist and reload the kernel state,
extract traceable requirement revisions, identify a useful share of planted defects without
intolerable false positives, let a human reconcile the resulting requirements/findings, freeze an
immutable baseline, and generate at least one internally consistent projection from that baseline.
Mermaid/state projection is the preferred proof because Phase 0 already established the
generation/validation seam. "Useful share" and "intolerable false positives" remain intentionally
empirical until the versioned evaluation corpus establishes a defensible baseline; Phase 1 must not
invent arbitrary precision/recall thresholds in advance.

Phase 2: Vertical Slice 2 — Interactive Requirements Discovery Loop
├── Promote generation gateway and Mermaid validation from Phase 0
├── Promote the isolated prototype runtime from Phase 0
├── Build requirements review / reconciliation UI
├── Generate process/state views from a specific requirements baseline
├── Generate interactive prototype behavior from the same baseline
├── Let SME review create candidate findings / requirement proposals
├── Feed diagram/prototype discoveries back into reconciliation
└── Create a new immutable baseline after accepted changes

Phase 3: Vertical Slice 3 — Engineering Handoff, Stories & Readiness
├── Introduce richer PolicyConstraint behavior where required by generated contracts
├── Introduce EngineeringDecision records where schema/API generation creates technical choices
├── PGlite / SQL validation and OpenAPI structural validation
├── Generate schema/API projections from the requirements baseline
├── Generate Gherkin stories mapped to exact requirement revisions + baseline
├── Implement deterministic Story Definition of Ready over structured state
├── Compute requirement-to-story coverage
└── Produce machine-readable story dependency graph

Phase 4: Vertical Slice 4 — Governance, Export & Pilot Hardening
├── Harden persistence for production
│   ├── approved enterprise storage / Azure Blob where appropriate
│   ├── retention and lifecycle policy
│   ├── backup / recovery
│   ├── concurrency semantics
│   ├── schema/data migrations
│   └── operational monitoring and cleanup
├── Microsoft Entra ID authentication integration
├── Azure DevOps / Jira / GitHub backlog export adapter
├── Add downstream staleness / impact analysis only where operationally required
└── Pilot on an active enterprise business workflow
```

Implementation discipline: the PRD describes destination concepts, not a mandate to create a TypeScript class, repository, service, or subsystem for every noun. Phase 1 issues shall implement only what is required to satisfy the Phase 1 exit criterion. `PolicyConstraint`, `EngineeringDecision`, dependency orchestration, impact analysis, richer readiness behavior, and production persistence concerns remain deferred until their owning slices require them.

## 9. Success Metrics & ROI (KPIs)

1. **Cycle Time to Validated Requirements Baseline:** Establish a project-specific baseline and target material reduction from current discovery lead time.
2. **Requirement Provenance Completeness:** 100% of normative requirements in an implementation-ready export reference accepted immutable evidence or an explicit accepted authority decision.
3. **Revision Integrity:** 100% of accepted baselines and exports reference exact immutable source/requirement revisions; no mutable "latest" links.
4. **Pre-Kickoff Conflict Resolution:** Track the number and severity of material contradictions and open product decisions resolved before engineering kickoff.
5. **Requirements Intelligence Evaluation:** Track misses and false positives by defect category against the versioned adversarial corpus; model/provider changes must not be judged only by anecdotal output quality.
6. **Story Readiness:** 100% of work labeled `implementation-ready` passes deterministic readiness and coverage gates over the referenced baseline and known findings.
7. **Engineering Scope Churn:** Target a **50% reduction** in post-kickoff change requests attributable to unstated requirements, contradictory rules, or schema/workflow mismatches.
8. **Downstream Human Intervention:** Measure how often implementation agents or engineers must stop because a story requires a product decision not captured in the source package; target a sustained downward trend.
9. **Artifact Cross-Validation Yield:** Track requirement defects discovered through prototype, process/state diagram, schema, API, and story projections before backlog export.
