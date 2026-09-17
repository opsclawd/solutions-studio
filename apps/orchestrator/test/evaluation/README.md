# Adversarial Requirements Evaluation Corpus (v1.0)

This directory contains the versioned adversarial synthetic evaluation corpus used by Phase 1 to benchmark requirement extraction, finding discovery, and provenance attribution prior to compiler tuning.

## Structure

```text
apps/orchestrator/test/evaluation/
  fixtures/
    <fixture-id>/
      source.md           # Single-source fixtures: front-matter + Markdown body
      source.<n>.md       # Multi-source and multi-revision fixtures
      expected.json       # Structural ground truth (conforms to EvaluationFixtureDtoSchema)
  manifests/
    corpus.v1.json        # Corpus manifest (corpusVersion: "v1.0") listing all fixtures and category tags
  support/
    loadFixture.ts        # Fixture loading and SHA-256 content hashing utility
    loadManifest.ts       # Manifest loading and fixture cross-validation utility
```

## Principles & Design Rules

1. **Source-Revision-Scoped Locators**: Expected evidence references adhere strictly to `{ sourceRevisionId, locator }`, identical to `EvidenceReferenceDtoSchema` from `@solutions-studio/contracts/requirements`. No divergent locator scheme is introduced.
2. **Revision-Per-File**: Every declared source revision has an explicit `path` mapping to its own physical file. In-memory representations are keyed by `sourceRevisionId`, ensuring distinct content and content hashes across successive revisions of the same source lineage.
3. **Category vs. Type Disambiguation**: Expected findings carry both fine-grained `category: FixtureCategorySchema` (for evaluation attribution and TP/FP/FN reporting) and coarse domain `type: FindingTypeSchema` (e.g. `contradiction`). This allows multiple distinct defect scenarios that share the domain type `contradiction` to be individually measured.
4. **Structural Ground Truth**: Expected requirements and findings are validated by structural identity, relations, and provenance rather than exact prose matching.
5. **Negative Cases / Expected Non-Findings**: Near-conflicts (such as scoped thresholds or paraphrased requirements) are explicitly modeled in `expectedNonFindings` to measure false positives.
6. **Synthetic and Safe**: All fixtures are synthetic enterprise scenarios safe for developer-configured model evaluation.

## Defect Categories

The corpus provides full coverage of the 12 required defect categories:

- `contradictory-approval-thresholds`
- `missing-actors-authorization`
- `incomplete-state-transitions`
- `missing-failure-recovery`
- `temporal-ambiguity`
- `undefined-cardinality`
- `unsupported-assumptions`
- `superseded-source-or-requirement`
- `source-authority-conflict`
- `false-positive-near-conflict`
- `data-boundary-ambiguity`
- `subjective-normative-language`

## Canonical Messy Discovery Package

`canonical-messy-discovery-package` serves as the Phase 1 end-to-end exit gate, planting examples of all 12 defect categories simultaneously across multiple sources and revisions.

### Source Lineage Map & Provable Translation

Fixture declarations use declared aliases (e.g. `MESSY-SOP-001-R2`), whereas `FilesystemRequirementsRepository.captureSourceRevision` serializes source revisions strictly from `sourceId` and ordinal (e.g. `CORE-SOP-001-R2`).

The evaluation runner builds an immutable, bijective `SourceLineageMap` for each fixture during ingestion. It validates:

- matching `sourceId`
- matching declared and captured ordinal
- matching source content hash
- translated predecessor relation (`supersedes` aliases map to captured predecessors)

Before structural scoring, all expected requirement and finding evidence references are translated via this map. Persisted reports record both declared aliases and normalized repository signatures losslessly. Downstream baseline and projection consumers (#12) consume these immutable persisted IDs rather than mutable "latest" state.

## Evaluation Execution Modes

### 1. Deterministic Local & CI Mode (Credential-Free)

The default evaluation runner uses `fixture-replay` to validate compiler wiring, lineage translation, structural scoring, persistence, and reporting without external network access or LLM credentials:

```bash
pnpm --filter @solutions-studio/orchestrator eval
```

> [!NOTE]
> Deterministic replay proves harness wiring, lineage mapping, and scoring correctness over synthetic fixtures. It does **not** represent empirical live model quality.

### 2. Real-Provider Candidate Validation Mode

To execute empirical evaluation against a configured real generation provider (`agy` or `opencode`) using the versioned synthetic corpus:

```bash
# Pin exact candidate commit SHA
export CANDIDATE_SHA=$(git rev-parse HEAD)

# Run evaluation with Antigravity CLI
pnpm --filter @solutions-studio/orchestrator eval \
  --provider agy \
  --candidate-sha "${CANDIDATE_SHA}" \
  --store ".evaluation-store" \
  --output "reports/evaluation-report-${CANDIDATE_SHA}.json" \
  --output-markdown "reports/evaluation-report-${CANDIDATE_SHA}.md"

# Or run with OpenCode CLI
pnpm --filter @solutions-studio/orchestrator eval \
  --provider opencode \
  --candidate-sha "${CANDIDATE_SHA}" \
  --store ".evaluation-store" \
  --output "reports/evaluation-report-${CANDIDATE_SHA}.json" \
  --output-markdown "reports/evaluation-report-${CANDIDATE_SHA}.md"
```

> [!IMPORTANT]
> The candidate SHA supplied via `--candidate-sha` represents `requested` provenance in the evaluation report unless independently verified by the operator. Live provider runs execute only against the versioned synthetic corpus; no production or customer data is transmitted.

## Phase 1 Release Batch Candidate Validation & Disposition Procedure

After all Phase 1 issues (#6–#12) have merged into the Release Batch branch and the coordinator locks the exact candidate SHA, an authoritative human operator performs Phase 1 validation against that exact SHA using the following procedure:

1. **Lock Exact Candidate SHA:**
   Ensure the working tree is clean and capture the exact candidate commit SHA:

   ```bash
   CANDIDATE_SHA=$(git rev-parse HEAD)
   echo "Validating Candidate SHA: ${CANDIDATE_SHA}"
   ```

2. **Execute Deterministic Synthetic Verification & Exit Gate:**
   Verify all unit tests, typecheck, linting, and the Phase 1 exit gate complete deterministically without network or live provider credentials:

   ```bash
   pnpm typecheck
   pnpm lint
   pnpm --filter @solutions-studio/orchestrator test
   pnpm --filter @solutions-studio/orchestrator exit-gate --store ".validation-store"
   ```

   > [!NOTE]
   > Passing `--store ".validation-store"` preserves the reconciled requirements repository and verified baseline `BASE-CANONICAL-MESSY-001` on disk beneath `apps/orchestrator/.validation-store` for subsequent real-provider baseline projection. A normal `exit-gate` invocation without `--store` creates and removes an ephemeral temporary store.

3. **Execute Real-Provider Candidate Evaluation (Synthetic Corpus Only):**
   Execute empirical evaluation against the configured real provider (`agy` or `opencode`) targeting the pinned candidate SHA:

   ```bash
   # Antigravity CLI
   pnpm --filter @solutions-studio/orchestrator eval \
     --provider agy \
     --candidate-sha "${CANDIDATE_SHA}" \
     --store ".evaluation-store" \
     --output "reports/evaluation-report-${CANDIDATE_SHA}.json" \
     --output-markdown "reports/evaluation-report-${CANDIDATE_SHA}.md"

   # or OpenCode CLI
   pnpm --filter @solutions-studio/orchestrator eval \
     --provider opencode \
     --candidate-sha "${CANDIDATE_SHA}" \
     --store ".evaluation-store" \
     --output "reports/evaluation-report-${CANDIDATE_SHA}.json" \
     --output-markdown "reports/evaluation-report-${CANDIDATE_SHA}.md"
   ```

   > [!IMPORTANT]
   > The candidate SHA supplied via `--candidate-sha` represents `requested` provenance in the evaluation report unless independently verified by the operator. Live provider runs execute only against the versioned synthetic corpus; no production or customer data is transmitted.

4. **Generate Real-Provider Baseline Projection & Closed-Loop Repair:**
   Execute baseline projection targeting the configured real provider against the verified baseline created in Step 2:

   ```bash
   pnpm --filter @solutions-studio/orchestrator project \
     --baseline BASE-CANONICAL-MESSY-001 \
     --artifact-type process-diagram \
     --provider agy \
     --store ".validation-store"
   # or
   pnpm --filter @solutions-studio/orchestrator project \
     --baseline BASE-CANONICAL-MESSY-001 \
     --artifact-type process-diagram \
     --provider opencode \
     --store ".validation-store"
   ```

   > [!NOTE]
   > The baseline projection command executes `ProjectBaselineUseCase` against `BASE-CANONICAL-MESSY-001` using the real `MermaidCliLinterAdapter` and the configured provider.
   > The command's output reports the projection ID, baseline ID, exact requirement revision IDs, repairs needed (`repairsNeeded`), attempt count, and SHA-256 content hash.
   > The full projection record is persisted to `apps/orchestrator/.validation-store/projections/<projection-id>.json`.

5. **Inspect Empirical Quality & Runtime Diagnostics:**
   - Reload the persisted run from `.evaluation-store` and verify parity with output reports.
   - Inspect category-specific misses (False Negatives).
   - Inspect expected-non-finding hotspots (False Positives from near-conflict traps).
   - Inspect unclassified candidate observations emitted by the compiler.
   - Inspect measured provider and model runtime metadata per fixture.
   - Verify 0 execution failures across all 16 fixtures.
   - Inspect the persisted baseline projection at `apps/orchestrator/.validation-store/projections/<projection-id>.json` and confirm provider provenance, revision coverage, and syntax validity.

6. **Record Authoritative Human Disposition:**
   Copy `docs/phase-1-report-template.md` to `docs/reports/phase-1-${CANDIDATE_SHA}.md` and complete all sections.
   Select exactly ONE human disposition:
   - **GO** — approve the exact candidate SHA and proceed to promotion; or
   - **DESIGN CHANGE** — reject the candidate and append remediation issue(s) to the release batch before re-testing.

   > [!CAUTION]
   > The autonomous implementation Run must not make this product/architecture promotion decision on the operator's behalf. Solutions Studio establishes empirical baselines; no arbitrary 90% or 95% pass threshold is enforced by software gates.
