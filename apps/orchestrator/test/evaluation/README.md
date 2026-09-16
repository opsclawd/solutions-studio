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

The corpus provides full coverage of the 10 required defect categories:

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

## Canonical Messy Discovery Package

`canonical-messy-discovery-package` serves as the Phase 1 end-to-end exit gate, planting examples of all 10 defect categories simultaneously across multiple sources and revisions.
