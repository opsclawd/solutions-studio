# Product Requirements Document (PRD)

**Product Name:** Spec-to-Prototype Delivery Engine ("Solutions Studio")**Document Version:** 1.0-MVP**Status:** Ready for Engineering Review**Target Architecture:** Enterprise Cloud / Private Azure Environment**Target Users:** Business Solutions Developers, Business Analysts, Solutions Architects, Business SMEs

## 1. Executive Summary & Problem Statement

### 1.1 The Problem

In enterprise IT, the discovery and requirements-gathering phase remains a primary bottleneck:

* **Abstract Communication:** Business SMEs communicate in terms of operational friction, physical forms, and spreadsheets. IT answers with text-heavy Business Requirement Documents (BRDs) that stakeholders skim but fail to fully visualize.
* **Delayed Feedback Loops:** Requirements often take 3 to 6 weeks to finalize. Missing operational edge cases, unstated field dependencies, and invalid approval chains are frequently discovered only during user acceptance testing (UAT) or post-release.
* **Proliferation of Shadow IT:** Faced with multi-month IT discovery backlogs, operational teams build unvetted, fragile Excel macros, Access databases, and ungoverned low-code apps that lack enterprise auth, backup pipelines, or cybersecurity oversight.

### 1.2 The Solution

The **Spec-to-Prototype Delivery Engine ("Solutions Studio")** is an internal, privacy-isolated AI workspace. It acts as a specialized compiler for business analysis: ingesting standardized Markdown summaries of SME interviews, standard operating procedures (SOPs), legacy schemas, and spreadsheets, and generating:

1. ​**Sandboxed, interactive form/UI prototypes**​.
2. ​**Deterministic Mermaid.js process diagrams and Entity-Relationship Diagrams (ERDs)**​.
3. ​**Normalized SQL DDL relational schemas and OpenAPI contracts**​.
4. ​**Traceable, Gherkin-formatted user stories with strict citation mapping**​.

By utilizing a ​**Markdown-First MVP Architecture**​, the platform bypasses the fragility, latency, and chunking failures of multimodal PDF/Excel ingestion, achieving 100% deterministic context recall within private, large-context LLM windows.

## 2. Product Goals & Non-Goals

### 2.1 Strategic Goals

* **Compress Discovery Timelines:** Reduce the cycle from first SME interview to interactive, validated prototype from weeks down to 48–72 hours.
* **Deterministic Grounding:** Ensure 100% of generated business rules, data schemas, and UI states link directly to verified SME transcripts or SOP citations.
* **Self-Healing Code/Diagrams:** Enforce an automated AST/linter loop that self-corrects invalid syntax before rendering artifacts to the user.
* **Governed Golden Paths:** Generate foundational artifacts that follow enterprise architectural standards (Clean Architecture, DDD, role-based access control, append-only audit histories).

### 2.2 Non-Goals (Explicitly Out of Scope for MVP)

* **Direct Multi-File Native Ingestion:** No direct PDF OCR, raw Excel parsing, or raw audio transcription in v1.0. All inputs must be converted into the standardized Markdown schema.
* **Autonomous Production Code Deployment:** The tool generates ​*prototypes, specifications, and scaffolding*​; it does not autonomously push production code to live environments.
* **Public Model Exposure:** No telemetry, source documents, or generated specs may leave the private corporate cloud boundary.

## 3. User Personas & Workflows

| Persona                                         | Role                     | Core Value Received                                                                                                                       |
| ------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Business Solutions Developer / BA**     | Primary Operator         | Automates the drafting of specs, ERDs, Gherkin stories, and UI prototypes. Leads real-time discovery sessions with SMEs.                  |
| **Business SME (Ops, Field, Compliance)** | Collaborator & Validator | Replaces abstract text reviews with clickable, interactive screen sandboxes and visual swimlanes, validating business logic in real time. |
| **Enterprise Architect / Lead Dev**       | Downstream Consumer      | Receives fully normalized relational DDL, OpenAPI 3.1 contracts, and Gherkin criteria with zero architectural drift.                      |

### 3.1 Primary MVP User Journey

```
[SME Interview / SOPs / Spreadsheets]
                │
                ▼ (Human-in-the-loop 5-10 min pass)
   Standardized Markdown Template (.md)
                │
                ▼
      [Solutions Studio UI]
   (Project Workspace Context Loaded)
                │
                ├──► Prompt: "Generate Interactive Intake Form" ──► Live React Sandbox
                ├──► Prompt: "Map State Machine & Approvals"    ──► Mermaid Process Flow
                ├──► Prompt: "Generate Relational Schema"       ──► PostgreSQL / T-SQL DDL
                └──► Prompt: "Synthesize User Stories"         ──► Gherkin BDD Specs
                │
                ▼
   [One-Click Handoff: Jira / Azure DevOps / Git Export]
```

## 4. Architectural & System Design

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        INTERFACE / PRESENTATION LAYER                       │
│  - Next.js (App Router) + Tailwind CSS + Monaco Code Editor                 │
│  - Interactive Sandboxed <iframe> Runtime (Client-side React Compilation)   │
│  - Fastify HTTP Controllers, SSE Streaming Handlers, Zod Payload Parsers     │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                      │ calls
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                           APPLICATION LAYER                                 │
│  Orchestration Use Cases:                                                           │
│  - GenerateArtifactUseCase (Coordinates Prompt -> LLM -> Linter -> Repair)  │
│  - ValidateWorkspaceContextUseCase                                              │
│  - ExportToBacklogUseCase                                                       │
│                                                                                │
│  Outbound Ports (Interfaces):                                                   │
│  - ILlmGateway (synthesize, repairSyntax)                                      │
│  - ICodeLinterGateway (validateAst, testSyntax)                                │
│  - IArtifactRepository (save, getByWorkspace)                                 │
│  - IBacklogExportGateway (pushWorkItem)                                       │
└───────────────────┬─────────────────────────────────────┬───────────────────┘
                    │ uses                                │ implemented by
┌───────────────────▼──────────────────────┐ ┌───────────▼───────────────────┐
│             DOMAIN LAYER                │ │     INFRASTRUCTURE LAYER     │
│  (Pure Business Rules & Entities)       │ │ (Swappable Technology Adapters│
│  - Entities: Workspace, Artifact, Story  │ │ - AzureOpenAiAdapter         │
│  - Value Objects: CitationReference,     │ │ - MermaidCliLinterAdapter     │
│    ValidationReport, AmbiguityScore     │ │ - BabelAstLinterAdapter       │
│  - Invariants: Zero ungrounded stories, │ │ - PGliteSchemaLinterAdapter   │
│    mandatory citation mapping, strict    │ │ - BetterSqliteRepository       │
│    state transition rules               │ │ - AzureDevOpsRestAdapter      │
└──────────────────────────────────────────┘ └───────────────────────────────┘
```

##### 4.1 Monorepo Structure & Clean Separation

The system is structured as a TypeScript monorepo to enforce architectural boundaries while keeping domain business rules independent from transport validation and infrastructure libraries:

* `packages/domain`: Contains domain entities, value objects, domain services, invariants, and domain errors. This package has **zero external runtime dependencies** and contains no framework, persistence, transport, UI, parser, or AI-provider concerns.
* `packages/contracts`: Contains shared application/API DTOs, Zod validation schemas, artifact serialization formats, and command/event contracts shared between applications. This package may depend on narrowly scoped boundary-validation libraries such as Zod but **must not contain domain business rules**.
* `apps/orchestrator`: Fastify backend implementing the Application use cases and Infrastructure adapters (Azure OpenAI, Babel AST linter, Mermaid CLI, Gherkin parser, SQLite).
* `apps/web`: Next.js frontend hosting the Monaco Markdown editor, SVG preview canvas, and sandboxed prototype iframe.

**Validation Boundary Rule:** Structural and transport validation belongs at system boundaries (`packages/contracts` and application adapters). Business validity belongs in `packages/domain`. For example, Zod may validate that a citation object contains a non-empty `sourceId`, while the domain enforces whether an artifact has sufficient verified citations to be accepted.

**Syntax vs. Domain Validation:** Parser-backed syntax checks are infrastructure concerns. A Gherkin parser determines whether generated acceptance criteria are syntactically valid; domain rules determine whether those criteria are grounded, testable, non-ambiguous, and sufficiently cited. Parser implementations must remain swappable behind application ports and must not become dependencies of `packages/domain`.

###### 4.2 The Markdown Ingestion Schema

To achieve deterministic outputs, the system requires all input files within a workspace to implement the following YAML Frontmatter + Markdown structure:

```
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

## 5. Functional Requirements (Features)

### FR-1: Workspace & Context Management

* **FR-1.1:** The system shall support project-based workspaces. All `.md` files uploaded to a workspace are concatenated into an active project context.
* **FR-1.2:** Context windows shall support up to 100,000 tokens of Markdown text per workspace, utilizing direct full-context loading into the LLM inference engine.
* **FR-1.3:** The workspace interface shall provide a Markdown editor (Monaco) allowing the BA to edit, format, and save changes to context files in real time.

### FR-2: Interactive Wireframe & Prototype Engine

* **FR-2.1:** Upon prompt (`/wireframe [workflow]`), the engine shall generate executable, single-file React components styled with Tailwind CSS utility classes.
* **FR-2.2:** The frontend shall execute the generated component inside an isolated, sandboxed `<iframe>` using an in-browser Babel compiler.
* **FR-2.3:** The UI sandbox shall simulate state transitions (e.g., clicking "Submit" transitions the form from editable inputs to a read-only pending approval state).
* **FR-2.4:** The generated prototype shall explicitly render all field validation messages defined in the Markdown context (e.g., error alert when `valve_pressure_psi > 800.0`).

### FR-3: Visual Process & Architecture Engine

* **FR-3.1:** Upon prompt (`/process` or `/erd`), the engine shall output valid Mermaid.js syntax:
  * Business workflows: `flowchart TD` or `sequenceDiagram`.
  * Data architecture: `erDiagram`.
  * Timelines & Milestones: `gantt`.
* **FR-3.2:** The system shall render the diagram within an interactive SVG viewport supporting zoom, pan, and SVG export.
* **FR-3.3 (Closed-Loop Syntax Repair):**
  * The backend shall execute a headless syntax pass using `@mermaid-js/mermaid-cli`.
  * If parsing fails, the error message and failed code shall be returned to the LLM with the prompt: *"The following Mermaid syntax produced an error: [Error]. Correct the syntax and return ONLY the valid Mermaid code."*
  * The system shall attempt up to 2 automated repair cycles before presenting an error to the user.

### FR-4: Data Contract & Relational Schema Engine

* **FR-4.1:** Upon prompt (`/schema [dialect]`), the engine shall generate normalized SQL DDL scripts supporting PostgreSQL and Microsoft Azure SQL / T-SQL.
* **FR-4.2:** Generated schemas must enforce:
  * Explicit Primary and Foreign Key constraints.
  * Appropriate indexing for search and foreign keys.
  * Audit trails: Append-only history tables or immutable status transition tracking tables (`entity_id`, `changed_by`, `action`, `timestamp`).
* **FR-4.3:** Upon prompt (`/api`), the engine shall generate valid OpenAPI 3.1 specifications (YAML/JSON) defining request/response shapes, parameter constraints, and HTTP status codes (200, 400, 401, 404, 500).

### FR-5: User Story & Acceptance Criteria Engine

* **FR-5.1:** Upon prompt (`/stories`), the engine shall generate user stories following standard Agile structure: ​*As a [Role], I want [Feature], So that [Business Outcome]*​.
* **FR-5.2:** Acceptance criteria must be formatted in strict **Gherkin BDD syntax** (`Scenario:`, `Given`, `When`, `Then`).
* **FR-5.3 (Source Citation Enforcement):** Every user story and acceptance criteria block must include an explicit citation back to the Markdown source (e.g., `[Ref: INT-004#Business Logic Rule 1]`).
* **FR-5.4 (Ambiguity Audit):** An automated evaluation pass shall flag subjective adjectives (e.g., "fast," "intuitive," "lightweight") that lack quantitative thresholds, recommending measurable parameters.

### FR-6: Artifact Handoff & Export

* **FR-6.1:** Users shall be able to export any artifact as raw Markdown, clean SQL, SVG diagrams, or standard React TSX files.
* **FR-6.2:** The system shall provide an export payload formatted for direct API synchronization with Jira and Azure DevOps backlog work items (Features, User Stories, Tasks).

## 6. Non-Functional Requirements (NFRs)

### 6.1 Security & Data Sovereignty

* **NFR-1.1 (Data Isolation):** Zero enterprise context data, transcripts, or generated schemas shall be transmitted to public LLM endpoints or used for external model training.
* **NFR-1.2 (Identity & Access):** The platform shall integrate with Microsoft Entra ID (Azure AD) via OAuth 2.0 / OpenID Connect with PKCE.
* **NFR-1.3 (Client Isolation):** Dynamic UI code generated by the LLM must execute exclusively within sandboxed `<iframe>` environments with restricted `sandbox="allow-scripts"` attributes, preventing parent DOM traversal or unauthorized cookie/token access.

### 6.2 Performance & Reliability

* **NFR-2.1 (Generation Latency):**
  * Text specifications (User stories, SQL schemas): < 8 seconds.
  * Mermaid diagrams: < 6 seconds.
  * Full React interactive prototype: < 15 seconds.
* **NFR-2.2 (Syntax Success Rate):** Automated self-healing loops must ensure > 98% of rendered Mermaid and React artifacts load without rendering exceptions on the first UI display.

## 7. Recommended Technical Stack (MVP)

| Component                    | Selected Technology                                                               | Architectural Rationale                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Frontend Framework** | **Next.js (App Router) + React, Tailwind CSS**                              | Split-pane dashboard rendering, fast server-side hydration, cohesive component ecosystem.      |
| **Editor & Viewers**   | ​**Monaco Editor**​,`@mermaid-js/mermaid`,`@tanstack/react-table` | Enterprise-grade syntax editing, interactive SVG diagramming, dynamic data grid inspection.    |
| **Prototype Sandbox**  | **Sandboxed iframe +`@babel/standalone`**                               | In-browser client-side compilation of React TSX; zero server execution risk.                   |
| **Backend API**        | **Node.js (TypeScript) with Fastify**                                       | Type-sharing with frontend, high-throughput asynchronous execution, lightweight footprint.     |
| **Validation Linters** | `@mermaid-js/mermaid-cli`,`zod`,`sqlfluff`/`@electric-sql/pglite` | Headless syntax parsers to validate and trigger self-correction loops before user rendering.   |
| **Persistence (MVP)**  | **Local File System / Azure Blob Storage + SQLite**                         | Minimal overhead for MVP; stores workspaces, versioned `.md` files, and generated artifacts. |
| **LLM Tier**           | **Azure OpenAI Service (GPT-4o)**                                           | Enterprise compliance, data privacy, and large context capacity (128k tokens).                 |

## 8. Delivery Plan: Vertical Slice Roadmap

```
Phase 0: Technical De-Risking (48-Hour Tracer Spikes)
├── Spike A: Closed-loop Mermaid CLI syntax auto-repair script (validate -> fail -> repair)
└── Spike B: Sandboxed <iframe> execution of dynamic LLM React/Tailwind code via @babel/standalone

Phase 1: Vertical Slice 1 — The Visual Process Canvas (Weeks 1–2)
├── Setup pnpm monorepo structure (/packages/domain, /packages/contracts, /apps/orchestrator, /apps/web)
├── Implement ILlmGateway (Azure OpenAI) and ICodeLinterGateway (Mermaid CLI)
├── Fastify /process endpoint with self-repair loop
└── Next.js split-pane UI: Monaco editor on left, interactive Mermaid SVG on right

Phase 2: Vertical Slice 2 — Spec & Data Contract Engine (Weeks 3–4)
├── Implement PGlite schema linter adapter (dry-run DDL validation)
├── Implement Ambiguity Audit engine for Gherkin acceptance criteria
├── Fastify /schema and /stories endpoints with mandatory source citation checks
└── Monaco split-view syntax highlighting for PostgreSQL/Azure SQL DDL & BDD specs

Phase 3: Vertical Slice 3 — Interactive Form Sandbox (Week 5)
├── Implement Babel AST parser for generated React components
├── Fastify /wireframe generation endpoint
└── Live sandbox runner inside Next.js with state toggle simulation and validation triggers

Phase 4: Vertical Slice 4 — Governance, Persistence & Handoff (Week 6)
├── SQLite / Azure Blob storage repository implementation
├── Microsoft Entra ID authentication integration
├── Azure DevOps / Jira API backlog export adapter
└── Pilot run on an active enterprise business workflow (e.g., Compliance / Field Inspection intake)
```

## 9. Success Metrics & ROI (KPIs)

1. **Cycle Time to Interactive Prototype:** Decreased from a baseline average of 15 business days to **under 3 business days** post-interview.
2. **First-Pass SME Alignment:** > 85% of core entities, validation boundaries, and approval steps confirmed during the initial prototype walkthrough.
3. **Engineering Scope Churn:** A **50% reduction** in post-kickoff sprint change requests caused by unstated requirements or schema mismatches.
4. **Toolchain Adoption:** Business Solutions Developers report saving **8+ hours per week** on routine artifact synthesis, diagramming, and spec drafting.

