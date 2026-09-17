# Phase 1 Evaluation Report & Decision Gate Template

## 1. Candidate Information

- **Candidate Git SHA:** `<pinned-candidate-sha>`
- **Evaluation Date / Timestamp:** `YYYY-MM-DDTHH:mm:ssZ`
- **Evaluator / Authority:** `<reviewer-name-or-role>`
- **Environment & Harness:** Local / CI Synthetic Test Harness (`scripts/run-evaluation.ts`)

---

## 2. Extraction Quality & Corpus Coverage

Summary of candidate requirement extraction metrics across the versioned benchmark corpus:

| Corpus Fixture                      | Target Requirements | Extracted | True Positives | False Positives | Recall | Precision |
| :---------------------------------- | :------------------ | :-------- | :------------- | :-------------- | :----- | :-------- |
| `missing-authorization-basic`       |                     |           |                |                 |        |           |
| `contradiction-basic`               |                     |           |                |                 |        |           |
| `temporal-ambiguity-basic`          |                     |           |                |                 |        |           |
| `canonical-messy-discovery-package` |                     |           |                |                 |        |           |
| **Total / Aggregate**               |                     |           |                |                 |        |           |

### Extraction Analysis & Notes

- Observation of requirement completeness against source locators:
- Accuracy of origin classifications (`EXPLICIT`, `ASSUMED`, `DERIVED`, `INFERRED`):
- Exactness and addressability of evidence references:

---

## 2.1 Defect Finding Discovery Quality by Category

Summary of candidate finding discovery metrics across all 10 defect categories:

| Defect Category                     | TP  | FP  | FN  | Precision | Recall | F1 Score |
| :---------------------------------- | :-: | :-: | :-: | :-------: | :----: | :------: |
| `contradictory-approval-thresholds` |     |     |     |           |        |          |
| `missing-actors-authorization`      |     |     |     |           |        |          |
| `incomplete-state-transitions`      |     |     |     |           |        |          |
| `missing-failure-recovery`          |     |     |     |           |        |          |
| `temporal-ambiguity`                |     |     |     |           |        |          |
| `undefined-cardinality`             |     |     |     |           |        |          |
| `unsupported-assumptions`           |     |     |     |           |        |          |
| `superseded-source-or-requirement`  |     |     |     |           |        |          |
| `source-authority-conflict`         |     |     |     |           |        |          |
| `false-positive-near-conflict`      |     |     |     |           |        |          |

- **Unclassified False Positive Observations Count:**
- **Category-specific Misses (False Negatives) Analysis:**

---

## 3. False-Positive Hotspots

Categories and root causes of spurious candidate findings or misclassified requirements:

### Identified Hotspots

1. **Hotspot Category 1:**
   - _Pattern:_
   - _Frequency:_
   - _Impact on Reconciliation Overhead:_
2. **Hotspot Category 2:**
   - _Pattern:_
   - _Frequency:_
   - _Impact on Reconciliation Overhead:_

---

## 4. Provider & Model Observations

Behavioral observations across model providers, prompts, and execution modalities:

- **Provider / Model Identity:** (e.g. `mock-fake`, `anthropic`, `openai`, `gemini`)
- **First-Pass Syntax & Structural Accuracy:**
- **Repair Behavior:**
  - Closed-loop repair iterations needed (max attempts observed vs default cap 2):
  - Common syntax errors caught by Mermaid CLI linter:
- **Latency & Determinism Observations:**

---

## 5. Evidence-Backed Design Changes

Concrete improvements, schema updates, or prompt refinements informed by corpus evaluation:

1. **Design Change 1:**
   - _Evidence / Finding:_
   - _Proposed or Implemented Change:_
2. **Design Change 2:**
   - _Evidence / Finding:_
   - _Proposed or Implemented Change:_

---

## 6. Phase 1 Exit Decision Gate

> [!IMPORTANT]
> The exit decision gate must remain blank and neutral until an authoritative human reviewer records empirical evaluation results from the candidate build.

### Recommendation Gate (Select Exactly One)

- [ ] **GO** — All extraction quality, reconciliation integrity, lineage blocking, and projection contracts satisfied with evidence.
- [ ] **CONDITIONAL** — Proceed to Phase 2 with explicit tracked remediations documented below.
- [ ] **NO-GO** — Quality or authority gate failure; requires revision and re-evaluation.

### Justification & Reviewer Sign-off

- **Rationale / Justification:**

- **Reviewing Authority (Sign-off):**
- **Date Signed:**
