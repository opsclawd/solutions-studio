# Phase 3 Evaluation Report & Decision Gate Template

## 1. Candidate Information

- **Candidate Git SHA:** `<pinned-candidate-sha>`
- **Release Batch:** `batch-2026-09-19-63-64-65-66-67-68-69` (issues #63–#69), release branch `release/2026-09-19-batch-63-64-65-66-67-68-69`
- **Evaluation Date / Timestamp:** `YYYY-MM-DDTHH:mm:ssZ`
- **Evaluator / Authority:** `<reviewer-name-or-role>`
- **Environment & Harness:** Real-provider candidate validation via `apps/orchestrator/scripts/run-phase-3-exit-gate.ts --provider agy --model <model> --runs 10`, executed from a clean worktree built at the locked candidate SHA.

---

## 2. Scope of Phase 3 Gate & Central Product Claim

Phase 3 implements Vertical Slice 3: **Engineering Handoff, Stories & Readiness**. The foundational premise of Phase 3 is encapsulated in its central product claim:

> **Engineering may make engineering decisions, but should not be forced to make unresolved product decisions.**

The exit gate executes a complete 15-step scenario on a locked synthetic authority package:

1. Ingest an enterprise standard (`SRC-ORD-001`) and establish an initial immutable baseline (`BASE-001`) with accepted requirement revisions and policy constraints.
2. Generate a relational SQL schema projection (PostgreSQL DDL) bound to `BASE-001`.
3. Validate the schema in an isolated PostgreSQL-compatible runtime (PGlite WASM).
4. Generate and structurally validate an OpenAPI 3.1.0 projection bound to `BASE-001`, cross-validating entity schemas with the relational schema.
5. Encounter a legitimate technical choice (identifier formatting) and record it as an `EngineeringDecision` (`ED-001` on `BASE-001`), transitioned from `PROPOSED` to `ACCEPTED`.
6. Encounter an ambiguous/missing product decision (paid order cancellation grace period) and record it as a `CandidateFinding` (`FIND-001: incomplete-state-machine`) in `OPEN` disposition.
7. Prove story readiness and engineering handoff bundle fail closed while product ambiguity remains unresolved.
8. Execute authorized human reconciliation (`dispositionFinding`, `reviseRequirement`, `acceptRequirement`, `resolveRequirement`) and freeze successor baseline (`BASE-002`) bound to the resolved requirement revision.
9. Record successor engineering decision (`ED-002` bound to `BASE-002`, supersedes `ED-001`) and regenerate affected SQL and OpenAPI 3.1.0 contracts against `BASE-002`.
10. Generate traceable Gherkin stories bound to `BASE-002` with scenario tags citing exact requirement revisions and policy constraints.
11. Compute deterministic requirement coverage (100% covered across `BASE-002`).
12. Compute deterministic story readiness (100% ready across all 10 Definition-of-Ready rules).
13. Build and validate machine-readable story dependency graph (acyclic DAG with topological execution levels).
14. Verify complete engineering-handoff bundle is implementation-ready with cryptographic content hashes verified.
15. Verify predecessor baselines, engineering decisions, candidate stories, and projections remain bit-identical and immutable across process restarts.

---

## 3. End-to-End 15-Step Scenario Verification

| Step   | Action                                                               | Run 1 | Run 2 | Run 3 | Stability & Status |
| :----- | :------------------------------------------------------------------- | :---: | :---: | :---: | :----------------- |
| **1**  | Establish baseline `BASE-001` with policy constraint                 |       |       |       |                    |
| **2**  | Generate SQL schema projection (PostgreSQL DDL)                      |       |       |       |                    |
| **3**  | Validate SQL in isolated runtime (PGlite WASM)                       |       |       |       |                    |
| **4**  | Generate & structurally validate OpenAPI 3.1.0 projection            |       |       |       |                    |
| **5**  | Record & accept technical choice as `EngineeringDecision` (`ED-001`) |       |       |       |                    |
| **6**  | Record missing product behavior as `CandidateFinding` (`FIND-001`)   |       |       |       |                    |
| **7**  | Prove story readiness fails closed on open finding                   |       |       |       |                    |
| **8**  | Human reconciliation & freeze successor baseline (`BASE-002`)        |       |       |       |                    |
| **9**  | Record `ED-002` (supersedes `ED-001`) & regenerate contracts         |       |       |       |                    |
| **10** | Generate traceable Gherkin stories (`STORY-001`, `STORY-002`)        |       |       |       |                    |
| **11** | Compute deterministic requirement coverage (100%)                    |       |       |       |                    |
| **12** | Compute deterministic story readiness (100% ready)                   |       |       |       |                    |
| **13** | Build & validate machine-readable story dependency graph             |       |       |       |                    |
| **14** | Verify complete implementation-ready engineering handoff bundle      |       |       |       |                    |
| **15** | Prove predecessor immutability & process-restart durability          |       |       |       |                    |

---

## 4. Contract Generation & Projection Quality

| Run       | Contract Projection | Artifact Type     | First-Pass Valid | Repairs Needed (max 2) | Declared Provenance Valid | Content Hash (SHA-256) |
| :-------- | :------------------ | :---------------- | :--------------: | :--------------------: | :-----------------------: | :--------------------- |
| **Run 1** | Schema `BASE-001`   | `sql-schema`      |                  |                        |                           |                        |
| **Run 1** | API `BASE-001`      | `openapi` (3.1.0) |                  |                        |                           |                        |
| **Run 1** | Schema `BASE-002`   | `sql-schema`      |                  |                        |                           |                        |
| **Run 1** | API `BASE-002`      | `openapi` (3.1.0) |                  |                        |                           |                        |
| **Run 1** | Story 1 `BASE-002`  | `stories`         |                  |                        |                           |                        |
| **Run 1** | Story 2 `BASE-002`  | `stories`         |                  |                        |                           |                        |
| **Run 2** | Schema `BASE-001`   | `sql-schema`      |                  |                        |                           |                        |
| **Run 2** | API `BASE-001`      | `openapi` (3.1.0) |                  |                        |                           |                        |
| **Run 2** | Schema `BASE-002`   | `sql-schema`      |                  |                        |                           |                        |
| **Run 2** | API `BASE-002`      | `openapi` (3.1.0) |                  |                        |                           |                        |
| **Run 2** | Story 1 `BASE-002`  | `stories`         |                  |                        |                           |                        |
| **Run 2** | Story 2 `BASE-002`  | `stories`         |                  |                        |                           |                        |
| **Run 3** | Schema `BASE-001`   | `sql-schema`      |                  |                        |                           |                        |
| **Run 3** | API `BASE-001`      | `openapi` (3.1.0) |                  |                        |                           |                        |
| **Run 3** | Schema `BASE-002`   | `sql-schema`      |                  |                        |                           |                        |
| **Run 3** | API `BASE-002`      | `openapi` (3.1.0) |                  |                        |                           |                        |
| **Run 3** | Story 1 `BASE-002`  | `stories`         |                  |                        |                           |                        |
| **Run 3** | Story 2 `BASE-002`  | `stories`         |                  |                        |                           |                        |

### Schema-API Cross-Validation Gate Multi-Run Stability

| Run Group                                   | Total Runs | Passing Runs | Pass Rate (%) | Primary Failure Signature(s)                                                                                                                                                                                                                                                          |
| :------------------------------------------ | :--------: | :----------: | :-----------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Round 5 Baseline (`397af2f8`, post-#86)** |     10     |      6       |      60%      | 4 failures: Run 3 (`/orders/{id}/payment` bare-noun view [#88]); Run 6 (`payment_authorizations.order_id` child FK omission [#86]); Run 9 (`OrderItemCreate` schema suffix naming [#84]); Run 10 (`OrderStatus` enum recognition [#82] + `/payment-authorizations` action path [#78]) |
| **Round 6 Baseline (`267f92e8`, post-#88)** |     10     |      7       |      70%      | 3 failures: Run 6 (`/orders/{id}/payment-authorization` on BASE-001); Run 7 (`/orders/{id}/payment-authorization` on BASE-002); Run 8 (`/orders/{id}/payment-authorizations` on BASE-001) [#90]                                                                                       |
| **Candidate Evaluation (`<pinned-sha>`)**   |     10     |              |               |                                                                                                                                                                                                                                                                                       |

- **Round 5 Baseline Variance Reference (6/10 = 60% pass rate in Round 5):**
  - Foreign key to parent omitted from child schema (#86 pattern): 1 / 10 runs (Run 6)
  - Entity schema naming suffix variation (e.g. `*Create`) (#84 pattern): 1 / 10 runs (Run 9)
  - Enum recognition / casing variation (#82 pattern): 1 / 10 runs (Run 10)
  - Action-verb or decision-annotated path segment variations (#78 pattern): 1 / 10 runs (Run 10)
  - Bare-noun sub-resource path representing parent-table view/state (#88 pattern): 1 / 10 runs (Run 3; remediated by #88)
- **Candidate Evaluation Observed LLM Variance Counts:**
  - Foreign key to parent omitted from child schema (#86 pattern): _count_
  - Entity schema naming suffix variation (e.g. `*Create`) (#84 pattern): _count_
  - Enum recognition / casing variation (#82 pattern): _count_
  - Action-verb or decision-annotated path segment variations (#78 pattern): _count_
  - Bare-noun sub-resource path representing parent-table view/state (#88 pattern): _must be 0_
- **Genuinely Novel Failure Signatures:** _none / list_

---

## 5. Authority Separation Witness: Technical Decisions vs Product Ambiguity

Verification of the architectural separation across authority layers:

1. **Technical Choice Representation (`EngineeringDecision`):**
   - Identifier selection (`UUIDv7` / `gen_random_uuid()`) recorded as `ED-001` scoped to `BASE-001`.
   - Initial State: `PROPOSED` -> Transitioned to `ACCEPTED` with architectural rationale.
   - Preserved as technical decision without fabricating business requirement or SME evidence.
   - Successor baseline `BASE-002` preserves technical choice via `ED-002` (`supersedes: 'ED-001'`).
2. **Product Ambiguity Representation (`CandidateFinding`):**
   - Unstated order cancellation window recorded as `FIND-001`.
   - Type conformance: `incomplete-state-machine` (strictly member of domain `FINDING_TYPES`).
   - Disposition: `OPEN`, discovered by `artifact-validation`.

---

## 6. Fail-Closed Story Readiness Gate Witness

Verification of fail-closed gates when unresolved product decisions exist:

1. **Candidate Story Readiness (`STORY-ORD-001-CANDIDATE`):**
   - References `REQ-ORD-01-R1` while `FIND-001` is `OPEN`.
   - Rule 5 (`no-blocking-open-findings`) evaluation outcome: `FAIL`.
   - Story status: `not-ready` (`isReady: false`).
2. **Engineering Handoff Gate:**
   - `GetEngineeringHandoffBundleUseCase` summary: `isHandoffReady: false`, `openBlockingFindings: 1`.

---

## 7. Human Authority Reconciliation & Successor Baseline

1. **Finding Disposition:** `FIND-001` transitioned from `OPEN` to `RESOLVED` with explicit human rationale.
2. **Requirement Revision Lineage:**
   - `REQ-ORD-01-R1` -> `reviseRequirement` -> `REQ-ORD-01-R2` (`PENDING`, `UNRESOLVED`)
   - `REQ-ORD-01-R2` -> `acceptRequirement` -> `REQ-ORD-01-R3` (`ACCEPTED`, `UNRESOLVED`)
   - `REQ-ORD-01-R3` -> `resolveRequirement` -> `REQ-ORD-01-R4` (`ACCEPTED`, `CLEAR`)
3. **Successor Baseline Freezing:**
   - `BASE-002` dynamically created with `resolvedRevision.id` (`REQ-ORD-01-R4`) and `REQ-ORD-02-R1`.

---

## 8. Traceability, Coverage & Dependency Graph

1. **Scenario Traceability:** Gherkin scenarios declare exact scenario tags (`@requirements:${resolvedRevision.id}`, `@policy-constraints:POL-SEC-01-R1`).
2. **Deterministic Coverage:** `ComputeRequirementCoverageUseCase` evaluates 100% coverage (2/2 requirements covered).
3. **Deterministic Readiness:** `EvaluateStoryReadinessUseCase` verifies 100% readiness (2/2 stories implementation-ready, 0 failures across all 10 rules).
4. **Dependency Graph:** `BuildStoryDependencyGraphUseCase` verifies acyclicity (`isAcyclic: true`, `validation.isValid: true`) with topological execution ordering (Level 0: `STORY-001`, Level 1: `STORY-002`).

---

## 9. Engineering Handoff Bundle Completeness

- `isHandoffReady: true`
- `readyStories: 2`, `nonReadyStories: 0`
- `coveredRequirements: 2`, `totalRequirements: 2`
- `openBlockingFindings: 0`
- Cryptographic SHA-256 content hashes verified across SQL, OpenAPI, and Story projections.

---

## 10. Historical Immutability & Process-Restart Durability Witness

- Repository state reloaded from disk across fresh process instance.
- `BASE-001` confirmed byte-identical to original specification.
- Duplicate baseline creation attempt rejected with `ImmutableRecordConflictError`.
- Predecessor engineering decision `ED-001` and candidate story `STORY-ORD-001-CANDIDATE` verified untouched.

---

## 11. Stability & Run-to-Run Variance Analysis

- **Provider / Model Identity:** `<pinned-provider>` / `<pinned-model>`
- **Run-to-Run Structural Invariants Consistency:**
- **Repair Behavior:**
- **Latency & Duration Metrics:**

### Determinism & Run-to-Run Variance Characterization (Phase 1 Precedent)

As established in Phase 1 evaluation (`docs/phase-1-candidate-validation-report.md` §4), real-provider generation calls without explicit temperature/sampling knobs exhibit non-deterministic category-level and naming variance across repeated runs. In Phase 3:

1. **Multi-Run Cross-Validation Requirement & Baselines (Rounds 5 and 6):** Evaluating candidate health requires running the exit gate across multiple independent runs ($N \ge 10$) rather than relying on a single pass/fail result.
   - **Round 5 Baseline (`397af2f8`, post-#86):** 6 out of 10 runs passed (6/10 = 60% baseline pass rate). The 4 failures in round 5 were: Run 3 (`/orders/{id}/payment` bare-noun view [#88]); Run 6 (`payment_authorizations.order_id` child FK omission [#86]); Run 9 (`OrderItemCreate` schema suffix naming [#84]); Run 10 (`OrderStatus` enum recognition [#82] + `/payment-authorizations` action path [#78]).
   - **Round 6 Baseline (`267f92e8`, post-#88):** 7 out of 10 runs passed (7/10 = 70% baseline pass rate, with `/orders/{id}/payment` bare-noun views completely resolved). All 3 failures exhibited a single recurring pattern: Run 6 (`/orders/{id}/payment-authorization` on BASE-001); Run 7 (`/orders/{id}/payment-authorization` on BASE-002); Run 8 (`/orders/{id}/payment-authorizations` on BASE-001) [#90].
2. **Distinguishing Known Variance from Code Defects:**
   - **Known Stochastic Variance:** When an exit-gate run fails on an already-remediated, unit-tested pattern (such as #86 child FK omission, #84 naming suffix variation, or #82 enum recognition) where prompt grounding (`sqlSchemaProjectionId`) is structurally wired, this represents residual LLM sampling variance rather than a code regression.
   - **Addressable Code Defects:** New structural gaps (such as #88's bare-noun view path `/orders/{id}/payment` or #90's `/orders/{id}/payment-authorization(s)` sub-resource boundary inconsistency) represent addressable defects that must be remediated in the cross-validator or generation prompt. Zero recurrence of `/orders/{id}/payment-authorization(s)` findings is required across candidate runs.

---

## 12. Phase 3 Exit Decision Gate

### Human Disposition Gate (Select Exactly One)

- [ ] **GO** — Approve the exact candidate SHA and proceed to release. All 15 exit-gate steps passed reliably across multiple independent real-provider validation runs, with zero recurrence of addressable structural gaps (such as #88) and residual failure rates characterized as known, acceptable LLM stochastic variance.
- [ ] **DESIGN CHANGE** — Reject the candidate SHA and append evidence-backed remediation issue(s) if novel defect signatures or regression in remediated gaps are observed.

### Justification & Reviewer Sign-off

- **Rationale / Justification:**
- **Reviewing Authority (Sign-off):**
- **Date Signed:**
