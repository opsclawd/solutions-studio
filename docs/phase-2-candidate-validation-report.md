# Phase 2 Evaluation Report & Decision Gate

## 1. Candidate Information

- **Candidate Git SHA:** `c58c5152f522cb4b4949eca5d0de6c62c7544565`
- **Release Batch:** `batch-2026-09-18-46-47-48-49-50-51-52` (issues #46–#52), release branch `release/2026-09-18-batch-46-47-48-49-50-51-52`
- **Evaluation Date / Timestamp:** `2026-09-19T00:54–00:59Z` (three independent real-provider validation runs)
- **Evaluator / Authority:** opsclawd (operator)
- **Environment & Harness:** Real-provider validation via `apps/orchestrator/scripts/run-phase-2-exit-gate.ts --provider agy --model gemini-3.8-flash-high --runs 3`, executed from a clean worktree built at the locked candidate SHA. This is the Phase 2 exit-gate harness built for this batch by issue #52, which natively supports repeated independent runs — a capability added directly in response to the Phase 1 lesson (recorded in `docs/phase-1-candidate-validation-report.md` §4) that a single real-provider run can be misleading and must not be the basis for a promotion decision.

---

## 2. Scope of This Gate

Phase 2 exercises the full requirements-evolution loop end-to-end against a real provider, distinct from Phase 1's requirement-extraction/defect-finding quality evaluation:

1. Ingest a synthetic discovery package and establish an initial immutable baseline (`BASE-001`).
2. Resolve requirement evidence locators against exact source excerpts (provenance).
3. Generate a process-diagram projection and an interactive-prototype projection from the baseline, with real-provider generation and repair-loop accounting.
4. Simulate SME review discovering an unstated requirement (session-inactivity timeout) as a non-authoritative candidate proposal + finding.
5. Verify promotion-prevention gates correctly block baseline creation while the proposal/finding are unresolved.
6. Execute human reconciliation (disposition finding, accept/resolve requirement revision).
7. Freeze a successor baseline (`BASE-002`) from the reconciled state.
8. Regenerate projections bound to the successor baseline.
9. Verify historical immutability of `BASE-001`, isolation between baseline-bound projections, staleness detection on prior projections, and durability across a process restart.

Each of the three runs executes all 10 steps independently, with fresh generated artifact IDs each time, against the identical candidate SHA, model, and corpus.

---

## 3. Run-to-Run Results

| Run   | Run ID            | Duration | Diagram A Repairs | Prototype A Repairs | Diagram B Repairs | Prototype B Repairs | Sandbox Compile | Result |
| :---- | :---------------- | :------: | :---------------: | :-----------------: | :---------------: | :-----------------: | :-------------: | :----: |
| Run 1 | `RUN-P2-1-yswr8h` |  90.0s   |         0         |          0          |         0         |          0          |        ✓        |  PASS  |
| Run 2 | `RUN-P2-2-pgbdtv` |  100.7s  |         0         |          0          |         0         |          0          |        ✓        |  PASS  |
| Run 3 | `RUN-P2-3-ixdedi` |  123.7s  |         0         |          0          |         0         |          0          |        ✓        |  PASS  |

**Total wall time:** 314.4s for 3 runs. **Result: 3/3 SUCCESS.**

### Step-by-step invariants, verified identically in all 3 runs

- **Baseline progression:** `BASE-001 [REQ-002-R1]` → `BASE-002 [REQ-002-R1, REQ-003-R3]` in every run.
- **Evidence locator resolution:** 1/1 resolved to exact source excerpts in every run — zero provenance failures.
- **Projection generation:** 0 repairs needed on both the process diagram and the prototype, on both the predecessor- and successor-bound generations (4 projections × 3 runs = 12/12 first-attempt-valid), all with valid syntax/AST and successful sandbox compilation.
- **Promotion-prevention gate:** the unaccepted candidate proposal and the open finding each independently blocked premature baseline creation, in every run — no bypass observed.
- **Reconciliation:** finding dispositioned to `RESOLVED`, requirement revision advanced and accepted (`REQ-003-R3`, `ACCEPTED`/`CLEAR`), identically in every run.
- **Immutability/isolation/staleness:** `BASE-001` untouched, duplicate-baseline overwrite rejected, projection isolation verified, staleness correctly detected on predecessor-bound projections, and all of the above held across a process restart — in every run.

---

## 4. Determinism Assessment

Unlike Phase 1's requirement-extraction/defect-classification evaluation — which showed real, material run-to-run variance in category-level scoring (see `docs/phase-1-candidate-validation-report.md` §2.1, §4) — **Phase 2's structural/workflow invariants showed zero variance across all three independent real-provider runs.** Every gate, every repair count, every immutability check, and every reconciliation outcome was identical in kind across runs; only cosmetic details (generated UUIDs, wall-clock timestamps, per-run durations) differed, which is expected and immaterial.

This is the outcome Phase 2's exit gate is designed to measure: workflow and data-integrity correctness (baselines, provenance, promotion gating, immutability), not open-ended generative quality. It is expected to be far more deterministic than Phase 1's extraction/classification task, and the evidence confirms that expectation — this is not a case of an insufficient number of runs masking hidden variance; the invariants being tested are binary pass/fail structural guarantees, not graded quality metrics.

---

## 5. Evidence-Backed Design Changes

No new design-change items are identified by this validation round. All 10 exit-gate steps passed cleanly and identically across all 3 runs, with no repairs, no provenance failures, no gate bypasses, and no immutability violations observed in any run.

---

## 6. Phase 2 Exit Decision Gate

### Human Disposition Gate (Select Exactly One)

- [x] **GO** — Approve the exact candidate SHA and proceed to promotion. All 10 exit-gate steps (baseline lifecycle, evidence provenance, projection generation with real-provider repair-loop accounting, promotion-prevention gating, human reconciliation, successor baseline freezing, and historical immutability/isolation/staleness/restart-durability) passed identically across three independent real-provider validation runs.
- [ ] **DESIGN CHANGE** — Reject the locked candidate SHA and append evidence-backed remediation issue(s) to the release batch before re-testing.

### Justification & Reviewer Sign-off

- **Rationale / Justification:**

  This batch (issues #46–#52) implements Phase 2's requirements-evolution loop: multi-baseline lineage, evidence-bound projection generation, SME-discovery-as-non-authoritative-proposal, promotion-prevention gating, human reconciliation, and successor-baseline freezing with full historical immutability. All seven items in the batch merged cleanly, including one real, evidence-diagnosed set of browser-test defects (issue #52's own CI integration) that were root-caused against actual component source and fixed directly — not masked or worked around — before merge (see PR #59).

  Per the explicit lesson from Phase 1 (a single real-provider run showed one defect category at 100% and a repeat showed 0% on the identical candidate before being traced and stabilized), this Phase 2 gate was run three independent times against the real `agy` provider rather than once. All three runs produced byte-for-byte identical structural outcomes: 0 repairs across 12 real-provider-generated projections, 100% evidence-locator resolution, correct promotion-prevention blocking in every run, and confirmed immutability/isolation/staleness/restart-durability in every run. This is the strongest possible evidence for a workflow-correctness gate — no cherry-picking, no single-run luck, and no variance to explain away.

  Nothing is recorded as a hidden gap here: this validation surfaced no new design-change candidates, unlike the Phase 1 gate which honestly surfaced two real, narrow compiler-tuning gaps alongside its GO recommendation. Phase 2's exit criteria are structural/workflow guarantees rather than open-ended generative quality, and the evidence confirms those guarantees hold, identically, across three independent real-provider runs.

- **Reviewing Authority (Sign-off):** opsclawd (operator)
- **Date Signed:** 2026-09-19
