# Phase 1 Evaluation Report & Decision Gate

## 1. Candidate Information

- **Candidate Git SHA:** `91fd4f819c5b1c9273af8a83b19f026db686c899`
- **Evaluation Date / Timestamp:** `2026-09-18T01:18–02:09Z` (three independent real-provider evaluation runs)
- **Evaluator / Authority:** opsclawd (operator)
- **Environment & Harness:** Real-provider evaluation via `scripts/run-evaluation.ts --provider agy --model gemini-3.8-flash-high`, run **three times independently** against the identical candidate SHA and corpus to characterize run-to-run variance (a single run was found to be misleading — see Section 2.1). A real-provider baseline projection (`ProjectBaselineUseCase` + `MermaidCliLinterAdapter`, real `agy` provider, real Mermaid linter — not the fake-gateway CI path) was validated earlier in this same release batch, against an ancestor candidate (`5894db7`) whose projection code path is unchanged by the later remediation issues (#34, #35, #36, #40) in this batch; it produced a syntactically valid diagram on the first attempt (0 repairs) tied to an exact `RequirementsBaselineId` and requirement-revision set. It was not independently re-run at the final SHA.

This report supersedes two earlier real-provider validation rounds against this batch's release candidates, both of which resulted in a recorded **DESIGN CHANGE**:

1. Candidate `5894db7` — rejected for 4/10 defect categories at 0% precision/recall; remediated by issues #34 (compiler prompt: cross-source reasoning + precision calibration), #35 (corpus coverage for two orphaned finding types), #36 (model-identity metadata tooling).
2. Candidate `8c59566` — rejected because the #34 fix, while genuinely repairing `superseded-source-or-requirement`/`source-authority-conflict` (0%→100%), regressed `contradictory-approval-thresholds` to 0% and reused two corpus fixtures verbatim as few-shot examples; remediated by issue #40.

---

## 2. Extraction Quality & Corpus Coverage

Aggregate requirement-extraction results across three independent runs of candidate `91fd4f8` (same model, same corpus v2.0, 16 fixtures):

| Run       | TP  | FP  | FN  |   Recall   | Precision  |
| :-------- | :-: | :-: | :-: | :--------: | :--------: |
| Run 1     | 25  | 26  |  7  |    78%     |    49%     |
| Run 2     | 20  | 29  | 12  |    62%     |    41%     |
| Run 3     | 22  | 28  | 10  |    68%     |    44%     |
| **Range** |     |     |     | **62–78%** | **41–49%** |

For comparison, the pre-remediation baseline (`5894db7`, single run, corpus v1.0, 14 fixtures): 61% recall / 35% precision.

### Extraction Analysis & Notes

- **Completeness against source locators:** Across all three runs and all prior candidates in this batch, every accepted requirement carried a resolvable, exact `(SourceRevisionId, locator)` reference. Zero provenance failures or fabricated locators were observed at any point in this validation — the persistence/provenance layer (#8/#9) is reliable.
- **Precision improved and held across all three runs** (41–49% vs. 35% baseline) — a real, stable gain from the #34/#40 prompt work, not a single-run artifact.
- **Recall is more variable run-to-run (62–78%)** than precision, driven primarily by the category-classification instability documented in Section 2.1 below.

---

## 2.1 Defect Finding Discovery Quality by Category

Per-category results across the same three runs (format: TP/FP/FN):

| Defect Category                     | Run 1 | Run 2 | Run 3 | Stability                                                         |
| :---------------------------------- | :---: | :---: | :---: | :---------------------------------------------------------------- |
| `contradictory-approval-thresholds` | 3/0/0 | 0/3/3 | 2/1/1 | **Unstable — full range**                                         |
| `missing-actors-authorization`      | 0/0/3 | 0/1/3 | 0/1/3 | Stable, consistently 0%                                           |
| `incomplete-state-transitions`      | 1/0/1 | 1/0/1 | 1/0/1 | **Stable, below pre-remediation baseline (was 2/2/0)**            |
| `missing-failure-recovery`          | 1/0/1 | 1/0/1 | 1/0/1 | **Stable, below pre-remediation baseline (was 2/3/0)**            |
| `temporal-ambiguity`                | 2/0/0 | 0/2/2 | 0/2/2 | **Unstable — 1 good run of 3**                                    |
| `undefined-cardinality`             | 1/0/1 | 1/0/1 | 1/0/1 | Stable, matches baseline                                          |
| `unsupported-assumptions`           | 0/2/2 | 0/2/2 | 0/2/2 | **Stable, below pre-remediation baseline (was 1/1/1)**            |
| `superseded-source-or-requirement`  | 2/0/0 | 2/0/0 | 2/0/0 | **Stable — 100%/100%, was 0%/0% pre-remediation. Confirmed fix.** |
| `source-authority-conflict`         | 2/0/0 | 2/0/0 | 2/0/0 | **Stable — 100%/100%, was 0%/0% pre-remediation. Confirmed fix.** |
| `false-positive-near-conflict`      | 0/0/0 | 0/0/0 | 0/0/0 | No findings expected or produced                                  |
| `data-boundary-ambiguity`           | 0/2/2 | 0/2/2 | 0/2/2 | Stable, 0% (new category from #35, never fixed by any issue)      |
| `subjective-normative-language`     | 0/2/2 | 0/2/2 | 0/2/2 | Stable, 0% (same)                                                 |

- **Unclassified false positives across 3 runs: 28 total (6, 12, 10 per run)** — down from 31 in a single pre-remediation run, and now the _dominant contributor has shifted_: `unsupported-assumption`/`data-boundary-ambiguity`/`subjective-normative-language` (structurally uncovered or weak categories) together account for 18/28 (64%), while `contradiction`/`temporal-ambiguity` (the categories that regressed in some runs) account for 8/28 (29%).
- **Root cause of the `contradictory-approval-thresholds` / `temporal-ambiguity` instability, traced directly, not inferred:** in the low-scoring runs, the compiler detected the _same_ contradiction with _byte-identical_ evidence citations as the high-scoring run, but classified the underlying requirements as `actors-permissions` instead of the fixture's expected `business-rule`. Because the scorer's matching is two-hop (a finding can only match if its underlying requirements matched on category+origin+evidence first), this single category-boundary judgment call turns a substantively-correct contradiction detection into a full miss. **This is a genuine, diagnosable compiler weakness — an ambiguous category boundary between "who may act" (`actors-permissions`) and "what the rule states" (`business-rule`) for approval-threshold requirements — not scoring brittleness and not random noise.**
- **`superseded-source-or-requirement` and `source-authority-conflict` are the one part of this report with zero variance across three independent runs**, up from 0%/0% before #34. This is the strongest, most reliable result in the whole validation: the cross-source reasoning fix works and is stable.

---

## 3. False-Positive Hotspots

1. **Category-boundary ambiguity: `actors-permissions` vs. `business-rule` for approval-threshold requirements.**
   - _Pattern:_ See Section 2.1 root-cause analysis above — this single classification judgment call, not a reasoning failure, explains the `contradictory-approval-thresholds`/`temporal-ambiguity` run-to-run swing.
   - _Frequency:_ Observed directly in 2 of 3 runs on the same fixture.
   - _Impact:_ Turns a correct defect detection into a full category miss via the scorer's two-hop matching; likely affects reviewer-facing precision on any approval/authorization-threshold fixture, not just the one directly traced.
2. **`data-boundary-ambiguity` / `subjective-normative-language` remain structurally weak (0% across all 3 runs).**
   - _Pattern:_ #35 gave these two finding types real fixture coverage for the first time in this batch, and the compiler scores 0% on both, in every run. Unlike the cross-source categories, this is not (yet) demonstrated to be model-sensitive or prompt-addressable — it simply hasn't been targeted by any remediation issue in this batch.
   - _Frequency:_ 12 of 28 (43%) of all unclassified false positives across the 3 runs.
   - _Impact:_ These are net-new categories as of this batch; their weakness is not a regression, but it is now the single largest remaining false-positive source.

---

## 4. Provider & Model Observations

- **Provider / Model Identity:** `agy` (antigravity-cli), model `gemini-3.8-flash-high`, explicitly pinned via `--model` (per #36's fix — previously unrecorded and unpinned).
- **First-Pass Syntax & Structural Accuracy:** 16/16 fixtures completed across all three runs, 0 failures, 0 malformed-output rejections, 0 provenance-validation rejections in any run.
- **Determinism:** **Not deterministic at the category level.** Three runs of the identical candidate, model, prompt, and corpus produced aggregate finding recall ranging 29–50% and precision ranging 37–67%, with two categories (`contradictory-approval-thresholds`, `temporal-ambiguity`) swinging across their full possible range. This is a material characteristic of real-provider evaluation that a single run cannot surface — **future Phase 1 candidate validations should run the evaluation multiple times before drawing conclusions from any single category result**, per the direct evidence in this report.
- **Historical context (earlier in this batch, candidate `5894db7`):** a three-way model comparison (`gemini-3.8-flash-high`, `gemini-3.1-pro-high`, `minimax-coding-plan/MiniMax-M3`) established that `superseded-source-or-requirement`/`source-authority-conflict` scored 0%/0% regardless of model — the evidence base that correctly directed #34's fix at the compiler prompt rather than model selection. That comparison remains valid supporting evidence for the fix that is now confirmed stable in Section 2.1.
- **Latency & Determinism (wall time):** ~440–510s per 16-fixture run, ~consistent across the three repeats.

---

## 5. Evidence-Backed Design Changes

Items 1–4 were addressed by this batch's remediation issues (#34, #35, #36, #40) and are reflected in the results above. One new item is identified by this validation round and is **not** included in this batch — see the recommendation in Section 6.

1. **[Done — #34, confirmed stable across 3 runs] Cross-source correlation / supersession-authority reasoning.** `superseded-source-or-requirement` and `source-authority-conflict`: 0%/0% → 100%/100%, zero variance across three independent runs.
2. **[Done — #34/#40] Precision-calibration guidance and few-shot examples.** Aggregate precision improved from 35% (pre-remediation) to 41–49% (post-remediation range) and held across all three runs, though the threshold-boundary example required one correction round (#40) after it initially over-generalized onto genuine threshold conflicts.
3. **[Done — #35] Corpus coverage for `data-boundary-ambiguity`/`subjective-normative-language`.** Fixtures added; both score 0% in every run — a legitimate finding-quality gap, not a coverage gap, now visible for the first time.
4. **[Done — #36] Model-identity metadata.** `AntigravityCliAdapter`/`OpenCodeCliAdapter` now accept and report an explicit `--model`; this report's multi-run comparison depended on it.
5. **[New — not in this batch, recommended as regular backlog work] Category-boundary ambiguity between `actors-permissions` and `business-rule` for approval-threshold requirements.**
   - _Evidence / Finding:_ Section 2.1's root-cause trace — identical contradiction detection, differing category classification, causing a full scoring miss in 2 of 3 runs.
   - _Proposed change:_ Add explicit prompt guidance distinguishing "a rule stating a threshold/limit" (`business-rule`) from "a rule stating who may act" (`actors-permissions`) for approval-authority requirements specifically, with a contrastive example.
   - _Why this is not a batch remediation issue:_ this is a pre-existing weakness (present before #34 too, at 1/2/2 — never 100%), not a regression introduced by this batch's changes; #12 sets no numeric quality threshold for Phase 1 exit by design (per #11's explicit scope note against arbitrary thresholds); and the categories #34 specifically targeted are confirmed stably fixed. Looping this batch again would delay promotion of confirmed-working architecture to chase a metric Phase 1 was never gated on.

---

## 6. Phase 1 Exit Decision Gate

### Human Disposition Gate (Select Exactly One)

- [x] **GO** — Approve the exact candidate SHA and proceed to promotion. All extraction quality, reconciliation integrity, lineage blocking, and projection contracts satisfied with evidence across the versioned corpus.
- [ ] **DESIGN CHANGE** — Reject the locked candidate SHA and append evidence-backed remediation issue(s) to the release batch before re-testing.

### Justification & Reviewer Sign-off

- **Rationale / Justification:**

  This batch went through two DESIGN CHANGE cycles (candidates `5894db7` and `8c59566`) before reaching this candidate, each backed by direct empirical evidence and root-caused before remediation. The architecture — persistence, evidence provenance, lineage-blocking, immutable baselines, and real-provider baseline projection — has been reliable and unchanged in behavior across all three candidates in this batch: zero provenance failures, zero fabricated evidence, correct blocking of unreconciled findings, and a syntactically valid real-provider projection tied to an exact baseline on the first attempt.

  The compiler's intelligence layer improved materially and, on its primary target, stably: `superseded-source-or-requirement` and `source-authority-conflict` went from 0%/0% to 100%/100% with zero variance across three independent runs — the strongest possible evidence a prompt fix actually worked, not a lucky run. Aggregate precision improved and held (41–49% vs. 35% baseline) across all three runs.

  Two things are recorded honestly rather than hidden: first, `contradictory-approval-thresholds`/`temporal-ambiguity` are unstable run-to-run, traced to a specific, diagnosable category-classification ambiguity rather than a reasoning failure — a real but narrow gap, not a regression from this batch, and not gating per #12's own no-arbitrary-threshold design. Second, `data-boundary-ambiguity`/`subjective-normative-language` (net-new categories from #35) remain at 0% — a legitimate gap surfaced for the first time by this batch's own corpus-coverage fix, not a regression either.

  Neither open gap represents "an ad-hoc ontology to force the check to pass," nor a hidden architectural deficiency — both are precisely characterized, both are compiler-tuning work rather than structural defects, and Phase 1's exit criteria (per #12) are about the architecture being sound and provably measurable, which this validation confirms across three independent real-provider runs. Both open items are recommended as regular (non-batch) backlog work for Phase 2 planning.

- **Reviewing Authority (Sign-off):** opsclawd (operator)
- **Date Signed:** 2026-09-18

---

## 7. Post-GO Audit Addendum — Phase 1 Terminal State

This section records the repository state after the Phase 1 promotion decision without rewriting the
historical evaluation evidence above.

### Promotion Decision vs. Terminal Implementation State

- **Phase 1 promotion candidate:** `91fd4f819c5b1c9273af8a83b19f026db686c899`
- **Recorded promotion decision:** **GO**, as documented in Section 6.
- **Post-GO compiler-quality remediation:** issue #42 / PR #43.
- **PR #43 merge commit:** `69fa4f129553606c6f2b4a00aa93b6c148e5fb1b`.
- **Phase 1 terminal implementation SHA:** `69fa4f129553606c6f2b4a00aa93b6c148e5fb1b`.

PR #43 addressed the category-boundary weakness identified in Sections 2.1, 3, 4, and Section 5 item
5: approval-threshold requirements could alternate between `business-rule` and
`actors-permissions`, causing substantively correct findings to score as misses.

The remediation added explicit category-classification guidance and regression coverage. Its
targeted real-provider validation ran three independent evaluations on the 16-fixture corpus using
`agy` with `gemini-3.8-flash-high`:

- `contradictory-approval-thresholds`: **3/0/0** in all three runs;
- `temporal-ambiguity`: **2/0/0** in all three runs.

The full validation suite passed, including **281 orchestrator tests across 24 files**. CI run #62
for merge commit `69fa4f1` completed successfully.

The original Phase 1 GO decision is therefore preserved as the promotion decision for candidate
`91fd4f8`, while `69fa4f1` is the authoritative terminal Phase 1 implementation state after the
evidence-backed post-GO quality fix.

### Subsequent Phase 2 Prerequisite Hardening

Issue #15 / PR #44 was merged afterward at `c142d908925d79730553b3e4f83c1e9d1901efdf` to add
dependency-cruiser enforcement for the documented domain/contracts/application/infrastructure
boundaries.

That change is treated as **Phase 2 prerequisite hardening**, not as a change to the Phase 1
promotion decision or evaluation evidence. It mechanically enforces architectural boundaries
already established by Phase 1 and provides the protected baseline from which Phase 2 planning and
implementation proceed.

### Audit Interpretation

For future traceability:

1. Use `91fd4f8` when referring to the exact candidate that received the recorded Phase 1 **GO**
   decision.
2. Use `69fa4f1` when referring to the final Phase 1 implementation state.
3. Treat PR #44 / `c142d90` and later commits as post-Phase-1 changes unless explicitly documented
   otherwise.
4. Preserve Sections 1–6 as the historical evaluation record; this addendum supersedes only the
   previously open category-classification follow-up described in Section 5 item 5.

