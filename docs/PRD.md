# Product Requirements Document (PRD)

**Product Name:** Evidence-to-Implementation-Ready Requirements Engine ("Solutions Studio")  
**Document Version:** 1.1-MVP  
**Status:** Ready for Engineering Review  
**Target Architecture:** Enterprise Cloud / Private Azure Environment  
**Target Users:** Business Solutions Developers, Business Analysts, Solutions Architects, Business SMEs

## 1. Executive Summary & Problem Statement

### 1.1 The Problem

In enterprise IT, discovery and requirements gathering remain primary bottlenecks:

* **Abstract Communication:** Business SMEs communicate in terms of operational friction, physical forms, spreadsheets, policies, and exceptions. IT frequently answers with text-heavy requirement documents that stakeholders struggle to validate in concrete terms.
* **Delayed Feedback Loops:** Missing operational edge cases, unstated field dependencies, contradictory rules, authorization gaps, and invalid approval chains are often discovered only during implementation, user acceptance testing (UAT), or after release.
* **Requirements Without Provenance:** User stories may be clear in isolation while still encoding unsupported assumptions, conflicting source material, or product decisions that were never explicitly made.
* **Downstream Automation Amplifies Input Quality:** As software delivery becomes increasingly automated, an implementation pipeline can faithfully and efficiently build the wrong behavior when the issue entering the pipeline is incomplete or incorrect.
* **Proliferation of Shadow IT:** Faced with long discovery backlogs, operational teams build unvetted Excel macros, Access databases, and ungoverned low-code apps that lack enterprise auth, backup pipelines, or cybersecurity oversight.

### 1.2 The Solution

**Solutions Studio** is an internal, privacy-isolated AI workspace that acts as a specialized **requirements compiler** for business analysis. It ingests standardized Markdown summaries of SME interviews, standard operating procedures (SOPs), legacy schemas, and spreadsheet-derived observations; extracts atomic requirements with source provenance; reconciles conflicts and open questions; and establishes a verified requirements baseline before generating downstream artifacts.

From that baseline, Solutions Studio can generate:

1. **Sandboxed, interactive form/UI prototypes** for stakeholder validation.
2. **Deterministically validated Mermaid.js process, state, and entity-relationship diagrams**.
3. **Normalized SQL DDL relational schemas and OpenAPI contracts**.
4. **Traceable, Gherkin-formatted user stories and acceptance criteria**.
5. **Story-readiness reports and dependency metadata** suitable for downstream automated SDLC execution.

The core product contract is not "Markdown in, artifacts out." It is:

```text
Evidence
  -> normalized source material
  -> canonical requirements model
  -> conflict / ambiguity / coverage resolution
  -> verified requirements baseline
  -> generated validation artifacts
  -> implementation-ready stories
  -> governed backlog export
```

Generated artifacts are **projections of the verified requirements baseline**, not independent sources of truth. A prototype, schema, diagram, or generated story may expose a missing requirement, but it cannot silently create authoritative business behavior.

The Markdown-first MVP avoids fragile multimodal ingestion and retrieval chunking while preserving stable source addressing. Full-context loading reduces retrieval-loss failure modes but does not imply perfect model recall; deterministic provenance and coverage checks remain mandatory.

## 2. Product Goals & Non-Goals

### 2.1 Strategic Goals

* **Compress Discovery Timelines:** Reduce the cycle from initial SME discovery to a validated requirements baseline and interactive validation artifacts from weeks to days for suitable workflows.
* **Traceable Grounding:** Ensure every accepted normative requirement is linked to source evidence or an explicitly accepted assumption/proposal.
* **Requirements Reconciliation:** Detect contradictions, missing boundaries, incomplete state machines, undefined authorization, unhandled failure behavior, cardinality gaps, and unresolved product decisions before backlog export.
* **Story Readiness:** Prevent stories from entering downstream engineering when implementation would still require the implementer to make product decisions.
* **Artifact Cross-Validation:** Use prototypes, process diagrams, data models, API contracts, and stories as alternate representations that test the same requirements baseline for gaps and inconsistencies.
* **Self-Healing Syntax:** Enforce automated parser/linter loops that self-correct invalid generated syntax before presenting artifacts to users.
* **Governed Golden Paths:** Generate foundational artifacts that follow enterprise architectural standards such as role-based access control, explicit lifecycle modeling, and append-only audit histories where applicable.
* **Provider Independence:** Keep generation orchestration independent from any specific model vendor, API, CLI, or agent runtime so generation backends can be replaced without changing domain or application business rules.

### 2.2 Non-Goals (Explicitly Out of Scope for MVP)

* **Direct Multi-File Native Ingestion:** No direct PDF OCR, raw Excel parsing, or raw audio transcription in v1.0. Inputs must first be converted into the standardized Markdown schema.
* **Autonomous Product Authority:** The model may extract, infer, propose, and flag requirements, but it may not silently resolve material business conflicts or promote unsupported behavior to `VERIFIED` status.
* **Generated Artifact Authority:** Wireframes, schemas, diagrams, and stories do not become authoritative simply because they were generated or accepted syntactically. New behavior discovered through an artifact must return to the requirements model for explicit resolution.
* **Autonomous Production Code Deployment:** The tool produces validated requirements packages, prototypes, specifications, and scaffolding; it does not autonomously push production code to live environments.
* **Unapproved Generation Provider Exposure:** Production enterprise context may only be transmitted through generation adapters and underlying providers approved for the deployment environment. Phase 0 tracer spikes may use developer-configured CLI adapters only with synthetic/non-sensitive fixtures unless the configured provider is enterprise-approved.

## 3. User Personas & Workflows

| Persona | Role | Core Value Received |
| --- | --- | --- |
| **Business Solutions Developer / BA** | Primary Operator | Converts discovery evidence into a reconciled requirements baseline, drives stakeholder resolution, and exports implementation-ready work. |
| **Business SME (Ops, Field, Compliance)** | Collaborator & Validator | Validates concrete process flows, rules, exceptions, UI behavior, and unresolved questions instead of reviewing only abstract prose. |
| **Enterprise Architect / Lead Dev** | Downstream Consumer | Receives traceable requirements, schemas, contracts, story dependencies, and readiness evidence with fewer unresolved product decisions. |
| **Automated SDLC / Engineering Team** | Downstream Executor | Receives stories that define product behavior clearly enough that implementation can focus on engineering decisions rather than requirement invention. |

### 3.1 Primary MVP User Journey

```text
[SME Interview / SOPs / Spreadsheets / Legacy Rules]
                │
                ▼ (Human normalization pass)
   Standardized Source Markdown (.md)
                │
                ▼
       [Requirements Compilation]
 Actors / Rules / States / Data / NFRs / Exceptions
                │
                ▼
      [Canonical Requirements Model]
 Provenance + lifecycle state + conflicts + questions
                │
                ▼
       [Requirements Review Loop]
 Resolve conflicts / assumptions / open product decisions
                │
                ▼
      [Verified Requirements Baseline]
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
│  - Requirements review / conflict resolution UI                             │
│  - Interactive Sandboxed <iframe> Runtime (Client-side React Compilation)   │
│  - Fastify HTTP Controllers, SSE Streaming Handlers, Zod Payload Parsers     │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                      │ calls
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                           APPLICATION LAYER                                 │
│  Orchestration Use Cases:                                                   │
│  - CompileRequirementsUseCase                                                │
│  - ReconcileRequirementsUseCase                                              │
│  - GenerateArtifactUseCase (Generate -> Validate -> Repair)                 │
│  - ValidateStoryReadinessUseCase                                             │
│  - ExportToBacklogUseCase                                                    │
│                                                                             │
│  Outbound Ports (Interfaces):                                               │
│  - IGenerationGateway (generate)                                             │
│  - ICodeLinterGateway (validateAst, testSyntax)                              │
│  - IArtifactRepository / IRequirementsRepository                             │
│  - IBacklogExportGateway (pushWorkItem)                                      │
└───────────────────┬─────────────────────────────────────┬───────────────────┘
                    │ uses                                │ implemented by
┌───────────────────▼──────────────────────┐ ┌───────────▼───────────────────┐
│             DOMAIN LAYER                │ │     INFRASTRUCTURE LAYER     │
│  (Pure Business Rules & Entities)       │ │ (Swappable Technology        │
│  - Workspace, Source, Requirement       │ │  Adapters)                    │
│  - EvidenceLink, Conflict, Story        │ │ - AntigravityCliAdapter      │
│  - RequirementStatus, StoryReadiness    │ │ - OpenCodeCliAdapter         │
│  - DependencyEdge, ValidationReport     │ │ - MermaidCliLinterAdapter    │
│  - Provenance and coverage invariants   │ │ - BabelAstLinterAdapter      │
│  - Readiness and authority rules        │ │ - PGliteSchemaLinterAdapter  │
│                                         │ │ - BetterSqliteRepository     │
│                                         │ │ - AzureDevOpsRestAdapter     │
└──────────────────────────────────────────┘ └───────────────────────────────┘
```

### 4.1 Monorepo Structure & Clean Separation

The system is structured as a TypeScript monorepo to enforce architectural boundaries while keeping domain business rules independent from transport validation and infrastructure libraries:

* `packages/domain`: Contains domain entities, value objects, domain services, invariants, and domain errors. This package has **zero external runtime dependencies** and contains no framework, persistence, transport, UI, parser, or generation-provider concerns.
* `packages/contracts`: Contains shared application/API DTOs, Zod validation schemas, artifact serialization formats, and command/event contracts shared between applications. This package may depend on narrowly scoped boundary-validation libraries such as Zod but **must not contain domain business rules**.
* `apps/orchestrator`: Fastify backend implementing Application use cases and Infrastructure adapters (generation CLI adapters, Babel AST linter, Mermaid CLI, Gherkin parser, SQLite).
* `apps/web`: Next.js frontend hosting source editing, requirements review/resolution, readiness reports, SVG previews, and the sandboxed prototype iframe.

**Validation Boundary Rule:** Structural and transport validation belongs at system boundaries (`packages/contracts` and application adapters). Business validity belongs in `packages/domain`. For example, Zod may validate that an evidence link contains a non-empty `sourceId`, while the domain enforces whether a requirement has sufficient accepted evidence to become authoritative.

**Syntax vs. Domain Validation:** Parser-backed syntax checks are infrastructure concerns. A Gherkin parser determines whether generated acceptance criteria are syntactically valid; domain rules determine whether criteria are grounded, testable, complete enough for the affected requirement, and free of unresolved product decisions.

### 4.2 Generation Gateway & CLI Adapter Boundary

The Application layer depends on a capability-oriented `IGenerationGateway`, not on an LLM vendor, model API, or specific CLI. The initial outbound contract remains intentionally narrow:

```ts
interface IGenerationGateway {
  generate(request: GenerationRequest): Promise<GenerationResult>;
}
```

* **Initial adapters:** `AntigravityCliAdapter` (`agy`) and `OpenCodeCliAdapter` (`opencode`). Provider selection is configuration-driven and must not alter application orchestration code.
* **Normalized execution contract:** CLI-specific output formats, exit codes, authentication failures, timeouts, conversation/session identifiers, and model metadata are normalized by the adapter into `GenerationResult` or typed gateway errors.
* **Application-owned repair loop:** Artifact-specific repair is not a gateway responsibility. `GenerateArtifactUseCase` constructs repair prompts, invokes `IGenerationGateway.generate(...)`, runs deterministic validators, and controls retry/exhaustion policy.
* **Text-generation mode:** Generation CLIs are invoked in a constrained, non-interactive mode with optional agent tooling disabled or restricted. Solutions Studio owns the workflow, validation loop, requirements lifecycle, and artifact lifecycle.
* **Deterministic testing:** A fake `IGenerationGateway` implementation must support automated orchestration tests without invoking a real CLI.
* **Future adapters:** Direct model APIs, enterprise-hosted inference, or local/open-weight runtimes may be added without changes to domain rules or application use cases.

### 4.3 Markdown Evidence Schema

All input files within a workspace must implement a stable YAML frontmatter + Markdown structure so generated requirement provenance remains addressable.

```md
---
workspace_id: "WS-OPS-001"
source_id: "INT-004"
title: "Secondary Line Inspection & Valve Verification"
source_type: "interview" # Enum: [interview, sop, schema, spreadsheet]
stakeholders: ["D. Smith (Field Lead)", "M. Johnson (Compliance Inspector)"]
date: 2026-09-15
status: "verified"
---

# Scope & Objective
[2-3 sentences summarizing the workflow or policy boundary]

# Personas & Roles
- **[Role Title]**: [Operational responsibility and access boundaries]

# Data Entities & Field Attributes
| Field Name | Type | Required | Boundary Constraints / Business Rules |
| :--- | :--- | :--- | :--- |
| `inspection_id` | UUID | Yes | Primary Key, system-generated |
| `valve_pressure_psi` | Float | Yes | Operating range: 450.0 - 850.0 PSI |
| `status` | Enum | Yes | DRAFT, SUBMITTED, IN_REVIEW, APPROVED, REJECTED |

# Business Logic & Operational Rules
1. If `valve_pressure_psi` exceeds 800.0, require secondary sign-off from Supervisor.
2. State transitions must follow: DRAFT -> SUBMITTED -> APPROVED | REJECTED.
3. Status changes are append-only; audit history must track user ID and timestamp.

# Edge Cases & Exceptions
- Intermittent connectivity: Tablet client must cache inspections locally.
- Conflicting submissions: Latest timestamp wins with diff flag.

# Ambiguities & Open Questions
- [ ] What is the escalation path if Supervisor approval exceeds 4 hours?
```

Markdown is the evidence transport for the MVP. It is not itself the canonical requirements model.

### 4.4 Canonical Requirements Model

Solutions Studio shall normalize source material into atomic requirements. Each requirement must be independently addressable and should contain, at minimum:

```ts
type Requirement = {
  id: RequirementId;
  statement: string;
  category: RequirementCategory;
  status: RequirementStatus;
  evidence: EvidenceLink[];
  rationale?: string;
  affectedActors?: ActorId[];
  dependencies?: RequirementId[];
  conflictsWith?: RequirementId[];
  resolution?: ResolutionRecord;
};
```

The minimum requirement lifecycle states are:

| Status | Meaning |
| --- | --- |
| `VERIFIED` | Accepted as authoritative business behavior and supported by evidence or explicit human approval. |
| `INFERRED` | Derived from verified facts but not itself directly stated; requires review before authority. |
| `PROPOSED` | Suggested by the system or reviewer as a possible requirement; not authoritative. |
| `ASSUMED` | Required to proceed but not confirmed; must be explicitly accepted before implementation-ready export. |
| `CONFLICTED` | Credible sources disagree materially. |
| `UNRESOLVED` | An unanswered question materially affects behavior or implementation. |
| `REJECTED` | Explicitly rejected; retained for audit/history but excluded from the active baseline. |

#### 4.4.1 Authority Rules

1. Generated artifacts cannot directly promote new business behavior to `VERIFIED`.
2. If a prototype walkthrough, diagram, schema, or story exposes a missing behavior, the system must create a `PROPOSED` or `UNRESOLVED` requirement and return it to the review workflow.
3. Material source conflicts must remain `CONFLICTED` until resolved by an authorized reviewer.
4. Requirement status transitions and resolutions must be auditable.
5. The active requirements baseline consists only of accepted authoritative requirements plus explicitly accepted assumptions.

#### 4.4.2 Provenance Rules

Every normative requirement exported downstream must preserve provenance to source evidence or an explicit resolution record.

Example:

```text
Requirement R-142
  Statement:
    Inspections above 800 PSI require supervisor approval.

  Evidence:
    INT-004#business-logic-1
    SOP-018#section-7.3

  Status:
    VERIFIED

  Resolution:
    accepted by reviewer on 2026-09-17

  Derived artifacts:
    STORY-31
    PROCESS-4
    SCHEMA-CONSTRAINT-12
    PROTOTYPE-STATE-8
```

The system must support both directions of traceability:

```text
source evidence -> requirement -> artifact/story
requirement -> covering stories / artifacts
```

### 4.5 Requirements Quality & Coverage Model

The requirements quality pass shall detect defects with direct downstream implementation cost, including:

* **Contradictions:** two credible sources define incompatible thresholds, states, permissions, or outcomes.
* **Missing authorization boundaries:** a capability is defined but the eligible actor or self-service boundary is unspecified.
* **Incomplete state machines:** missing rejection, cancellation, retry, timeout, reopen, or terminal behavior where relevant.
* **Missing failure behavior:** external calls, persistence, network failure, retries, idempotency, and recovery are undefined where the workflow depends on them.
* **Undefined cardinality:** relationships such as one-to-one, one-to-many, optional, or required remain unspecified where they affect behavior.
* **Temporal ambiguity:** ordering, deadlines, synchronization, queuing, and timeout behavior are unclear.
* **Data-boundary ambiguity:** ranges, units, uniqueness, mutability, lifecycle, or ownership are unspecified.
* **Subjective language:** terms such as "fast," "intuitive," or "lightweight" are used without measurable meaning where measurability is required.

Coverage must be measured mechanically rather than inferred from a model assertion. Example:

```text
Extracted authoritative requirements: 87
Covered by implementation-ready stories: 82
Explicitly excluded from current scope: 3
Unresolved: 2

Coverage status: FAIL
Uncovered: R-41, R-73
```

## 5. Functional Requirements (Features)

### FR-1: Workspace & Evidence Management

* **FR-1.1:** The system shall support project-based workspaces containing standardized source Markdown and generated/derived artifacts.
* **FR-1.2:** Context windows shall support up to 100,000 tokens of curated Markdown text per workspace using direct full-context loading into the configured generation runtime.
* **FR-1.3:** The workspace interface shall provide a Markdown editor allowing the BA to edit, format, and save source material.
* **FR-1.4:** Each source document shall expose a stable `source_id` and addressable sections suitable for evidence links.
* **FR-1.5:** Source status and revisions shall be preserved so provenance remains auditable when source material changes.

### FR-2: Requirements Compilation & Reconciliation

* **FR-2.1:** Upon request, the engine shall extract atomic requirements from active workspace evidence into the canonical requirements model.
* **FR-2.2:** Extraction shall classify requirements across actors/permissions, business rules, lifecycle/state, data constraints, integrations, failure behavior, exceptions, and NFRs where present.
* **FR-2.3:** Every extracted requirement shall carry one or more evidence links or be explicitly classified as `INFERRED`, `PROPOSED`, or `ASSUMED`.
* **FR-2.4:** The system shall detect and surface material contradictions across source documents without autonomously choosing a winner.
* **FR-2.5:** The system shall detect missing implementation-relevant boundaries, including authorization, state transitions, failure behavior, cardinality, temporal behavior, data constraints, and undefined exception paths.
* **FR-2.6:** Reviewers shall be able to verify, reject, edit, resolve, or explicitly accept assumptions while preserving an auditable resolution history.
* **FR-2.7:** The system shall establish a versioned verified requirements baseline that downstream artifact generation references by identifier/version.

### FR-3: Interactive Wireframe & Prototype Engine

* **FR-3.1:** Upon prompt (`/wireframe [workflow]`), the engine shall generate executable, single-file React components or another approved constrained representation from the active verified requirements baseline.
* **FR-3.2:** The frontend shall execute generated dynamic code inside an isolated, sandboxed `<iframe>` using the approved compilation/runtime contract.
* **FR-3.3:** The UI sandbox shall simulate verified state transitions, authorization-sensitive behavior, validation states, and relevant error conditions.
* **FR-3.4:** Prototype behavior that is not traceable to the current requirements baseline must be flagged as proposed rather than silently accepted as authoritative.
* **FR-3.5:** Stakeholder discoveries during prototype review shall be promotable back into the requirements review workflow.

### FR-4: Visual Process & Architecture Engine

* **FR-4.1:** Upon prompt (`/process`, `/state`, or `/erd`), the engine shall output valid Mermaid.js syntax using the active requirements baseline:
  * Business workflows: `flowchart TD` or `sequenceDiagram`.
  * State/lifecycle behavior: supported Mermaid state representation where appropriate.
  * Data architecture: `erDiagram`.
  * Timelines & Milestones: `gantt` where explicitly requested.
* **FR-4.2:** The system shall render diagrams within an interactive SVG viewport supporting zoom, pan, and SVG export.
* **FR-4.3 (Closed-Loop Syntax Repair):**
  * The backend shall execute a headless syntax pass using `@mermaid-js/mermaid-cli`.
  * If parsing fails, the application shall construct a repair request containing the parser error and failed Mermaid source and send it through `IGenerationGateway`.
  * The system shall attempt up to 2 automated repair cycles before presenting a typed validation failure to the user.
* **FR-4.4:** Diagram generation/review shall surface requirement inconsistencies such as unreachable states, missing terminal paths, or approval flows lacking authoritative requirements.

### FR-5: Data Contract & Relational Schema Engine

* **FR-5.1:** Upon prompt (`/schema [dialect]`), the engine shall generate normalized SQL DDL scripts supporting PostgreSQL and Microsoft Azure SQL / T-SQL from verified data requirements.
* **FR-5.2:** Generated schemas shall enforce verified primary/foreign key constraints, relevant indexes, uniqueness/cardinality rules, and audit/history semantics.
* **FR-5.3:** Upon prompt (`/api`), the engine shall generate valid OpenAPI 3.1 specifications defining request/response shapes, parameter constraints, authorization-relevant contract behavior, and applicable HTTP status/error semantics.
* **FR-5.4:** A schema or API contract may surface missing constraints as findings, but those findings must return to requirements reconciliation before becoming authoritative behavior.

### FR-6: User Story, Acceptance Criteria & Readiness Engine

* **FR-6.1:** Upon prompt (`/stories`), the engine shall generate user stories following standard Agile structure: *As a [Role], I want [Feature], so that [Business Outcome]*.
* **FR-6.2:** Acceptance criteria shall be formatted in strict **Gherkin BDD syntax** (`Scenario:`, `Given`, `When`, `Then`).
* **FR-6.3 (Requirement Traceability):** Every story and normative acceptance-criteria block shall reference canonical requirement IDs. Canonical requirements preserve source evidence; story export must not rely on free-form citations alone.
* **FR-6.4 (Behavioral Completeness):** Story generation shall include relevant negative paths, failure behavior, authorization boundaries, state transitions, and data constraints when those behaviors are part of the covered requirements.
* **FR-6.5 (Ambiguity Audit):** An automated pass shall detect subjective or untestable language and implementation-relevant ambiguity.
* **FR-6.6 (Definition of Ready):** A story shall not be marked implementation-ready unless, where applicable:
  * the business outcome is identified;
  * actor and authorization boundaries are explicit;
  * scope and exclusions are explicit;
  * acceptance criteria are testable;
  * happy path and relevant negative paths are covered;
  * state transitions are covered;
  * data constraints are covered;
  * failure/recovery behavior is specified;
  * applicable NFRs are attached;
  * dependencies are identified;
  * every normative clause maps to accepted requirements;
  * no unresolved conflict materially affects implementation;
  * no unresolved ambiguity requires an implementer to make a product decision;
  * assumptions required for implementation are explicitly accepted.
* **FR-6.7 (Coverage Gate):** The system shall report authoritative requirements that are uncovered, explicitly excluded, or unresolved before backlog export.
* **FR-6.8 (Dependency Graph):** The system shall produce machine-readable story dependency metadata suitable for sequencing downstream work.

### FR-7: Artifact Handoff & Export

* **FR-7.1:** Users shall be able to export artifacts as raw Markdown, clean SQL, SVG diagrams, approved prototype source/representation, and structured requirement/story manifests.
* **FR-7.2:** The system shall provide export payloads for Jira, Azure DevOps, and/or GitHub backlog work items containing story text, acceptance criteria, requirement IDs, readiness status, and dependency metadata.
* **FR-7.3:** Only stories that pass the configured readiness policy may be exported as `implementation-ready`; incomplete work may be exported only with an explicit non-ready status.
* **FR-7.4:** Export identifiers shall support future end-to-end traceability from source evidence through requirement, story, downstream issue, implementation, test, and PR.

## 6. Non-Functional Requirements (NFRs)

### 6.1 Security & Data Sovereignty

* **NFR-1.1 (Generation Data Boundary):** Enterprise context, transcripts, and generated specifications may only be transmitted through explicitly configured generation adapters whose underlying provider/runtime is approved for the deployment environment. Phase 0 tests against unapproved external providers must use synthetic or non-sensitive fixtures.
* **NFR-1.2 (Identity & Access):** The platform shall integrate with Microsoft Entra ID (Azure AD) via OAuth 2.0 / OpenID Connect with PKCE.
* **NFR-1.3 (Client Isolation):** Dynamic UI code generated by the generation runtime must execute exclusively within sandboxed `<iframe>` environments with restricted sandbox attributes, preventing parent DOM traversal or unauthorized cookie/token access. The sandbox must additionally enforce a restrictive Content Security Policy that blocks unauthorized outbound network access.
* **NFR-1.4 (Generation Runtime Isolation):** CLI generation adapters must run with only the capabilities required for text generation and must not implicitly receive unrelated workspace or environment access.
* **NFR-1.5 (Auditability):** Requirement state changes, conflict resolutions, accepted assumptions, baseline versions, and readiness decisions must be auditable.

### 6.2 Reliability, Quality & Performance

* **NFR-2.1 (Generation Latency):** Latency targets are experience goals rather than authority/quality gates. Deterministic validation, provenance, reconciliation, and readiness checks take precedence over meeting a generation latency target.
* **NFR-2.2 (Syntax Success Rate):** Automated self-healing loops should ensure > 98% of rendered Mermaid and approved dynamic prototype artifacts load without rendering exceptions on first presentation after repair processing.
* **NFR-2.3 (Provider Substitutability):** Switching between supported generation adapters must not require changes to domain rules, use-case orchestration, requirement validity rules, artifact validators, or API contracts.
* **NFR-2.4 (Provenance Completeness):** The system shall reject implementation-ready export when any normative story clause lacks an accepted requirement mapping.
* **NFR-2.5 (Coverage Determinism):** Requirement-to-story coverage shall be computed from identifiers/relationships rather than from an LLM self-assessment.

## 7. Recommended Technical Stack (MVP)

| Component | Selected Technology | Architectural Rationale |
| --- | --- | --- |
| **Frontend Framework** | **Next.js (App Router) + React, Tailwind CSS** | Requirements review, split-pane editing, readiness reports, artifact previews, and sandbox hosting. |
| **Editor & Viewers** | **Monaco Editor**, `@mermaid-js/mermaid`, `@tanstack/react-table` | Source editing, visual diagramming, requirements/conflict tables, and readiness inspection. |
| **Prototype Sandbox** | **Sandboxed iframe + `@babel/standalone`** | In-browser execution of constrained generated React TSX under a documented isolation contract. |
| **Backend API** | **Node.js (TypeScript) with Fastify** | Type-sharing, asynchronous orchestration, and lightweight application services. |
| **Validation Linters** | `@mermaid-js/mermaid-cli`, `zod`, Gherkin parser, `sqlfluff` / `@electric-sql/pglite` | Deterministic syntax/structure validation surrounding probabilistic generation. |
| **Persistence (MVP)** | **Local File System / Azure Blob Storage + SQLite** | Versioned source, requirements baselines, resolutions, artifacts, and export manifests with minimal operational overhead. |
| **Generation Runtime** | **Provider-agnostic CLI adapters; initial implementations: Antigravity (`agy`) and OpenCode (`opencode`)** | Preserves model/provider portability behind `IGenerationGateway`. |

## 8. Delivery Plan: Vertical Slice Roadmap

Phase 0 implementations are **mergeable tracer implementations**, not disposable prototypes. They establish reusable seams, tests, fixtures, typed failures, and documented findings that carry forward.

```text
Phase 0: Technical De-Risking (existing tracer work)
├── Spike A: Provider-Agnostic Generation + Closed-Loop Mermaid Repair
│   ├── IGenerationGateway + deterministic fake
│   ├── AntigravityCliAdapter + OpenCodeCliAdapter
│   ├── Typed gateway failures
│   └── Invalid Mermaid -> validate -> repair -> revalidate within <= 2 attempts
└── Spike B: Sandboxed <iframe> execution of generated React/Tailwind
    ├── Demonstrate state transitions and validation behavior
    ├── Prevent child access to parent DOM/storage
    └── Enforce restrictive CSP for outbound network access

Phase 1: Vertical Slice 1 — Requirements Intelligence Core
├── Canonical Requirement / EvidenceLink / RequirementStatus domain model
├── Atomic requirement extraction from standardized Markdown
├── Provenance validation and source addressing
├── Conflict and implementation-boundary detection
├── Human resolution workflow and auditable state transitions
└── Versioned verified requirements baseline

Phase 2: Vertical Slice 2 — Process & Requirements Cross-Validation
├── Promote generation gateway and Mermaid validation from Phase 0
├── Generate process/state/ERD views from the verified baseline
├── Surface diagram-discovered gaps back into requirements review
└── Requirements review UI + coverage report

Phase 3: Vertical Slice 3 — Data Contracts, Stories & Readiness
├── PGlite / SQL validation and OpenAPI structural validation
├── Generate schema/API projections from the verified baseline
├── Generate Gherkin stories mapped to canonical requirement IDs
├── Implement ambiguity / behavioral-completeness audit
├── Implement deterministic Story Definition of Ready
├── Compute requirement-to-story coverage
└── Produce machine-readable story dependency graph

Phase 4: Vertical Slice 4 — Interactive Prototype & Governed Handoff
├── Promote isolated prototype runtime from Phase 0
├── Generate prototype behavior only from accepted requirements
├── Feed SME-discovered behavior back into requirements review as proposals
├── SQLite / Azure Blob persistence
├── Microsoft Entra ID authentication integration
├── Azure DevOps / Jira / GitHub backlog export adapter
└── Pilot on an active enterprise business workflow
```

## 9. Success Metrics & ROI (KPIs)

1. **Cycle Time to Validated Requirements Baseline:** Establish a project-specific baseline and target material reduction from current discovery lead time.
2. **Requirement Provenance Completeness:** 100% of normative requirements in an implementation-ready export have accepted evidence or an explicit accepted resolution/assumption.
3. **Pre-Kickoff Conflict Resolution:** Track the number and severity of material contradictions and open product decisions resolved before engineering kickoff.
4. **Story Readiness:** 100% of work labeled `implementation-ready` passes deterministic readiness and coverage gates.
5. **Engineering Scope Churn:** Target a **50% reduction** in post-kickoff change requests attributable to unstated requirements, contradictory rules, or schema/workflow mismatches.
6. **Downstream Human Intervention:** Measure how often implementation agents or engineers must stop because a story requires a product decision not captured in the source package; the target is a sustained downward trend.
7. **Artifact Cross-Validation Yield:** Track requirement defects discovered through prototype, process/state diagram, schema, API, and story projections before backlog export.
