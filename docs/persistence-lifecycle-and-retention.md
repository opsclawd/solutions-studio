# Persistence Lifecycle & Retention Policy

This document defines the production data classification, durability tiers, backup strategies, and retention/pruning policies for Solutions Studio in accordance with Phase 4.1 requirements.

## 1. Data Classification Matrix

| Class       | Name                  | Entities / Artifacts                                                                                        | Storage Tier                       | Retention Policy                                                                                                                                     | Mutability                   | Protection Level                                                              |
| ----------- | --------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------- |
| **Class A** | Permanent / Immutable | Source revisions, Requirement revisions, Baselines, Accepted decisions, Cryptographic hashes, Audit history | PostgreSQL + Object Storage (Blob) | Indefinite / Permanent                                                                                                                               | Strictly Immutable           | Tier 1 (Never pruned, strictly guarded by foreign keys and hash verification) |
| **Class B** | Long-term / Retained  | Engineering decisions, Stories, Projections, Backlog export mappings                                        | PostgreSQL + Object Storage        | Retained for product lifecycle (minimum 7 years)                                                                                                     | Versioned / Append-only      | Tier 2 (Protected while linked to active Baselines)                           |
| **Class C** | Evaluation / Prunable | Evaluation run fixtures, automated test runs, metric reports                                                | PostgreSQL + Object Storage        | Two-horizon policy: Raw fixture blobs pruned after 14 days; summary metrics retained for 90 days; unconditionally retain last $K$ runs (default: 10) | Append-only until pruned     | Tier 3 (Automated lifecycle cleanup)                                          |
| **Class D** | Transient / Ephemeral | Scratch files, staging tables, temp exports, unreferenced projections                                       | Filesystem (`/tmp`, scratch)       | 24–48 hours                                                                                                                                          | Ephemeral                    | Tier 4 (Automated deletion on completion or daily sweep)                      |
| **Class E** | Audit / Compliance    | Reconciliation records, verification logs, access attestations                                              | PostgreSQL                         | Retained per enterprise compliance policy (default: 7 years)                                                                                         | Append-only / Tamper-evident | Tier 1 (Read-only, exportable for auditor review)                             |
| **Class F** | Cache / Rebuildable   | Locator indexes, search indexes, rendered diagrams                                                          | PostgreSQL / Memory                | Evictable on demand; rebuildable from Class A sources                                                                                                | Cache                        | Tier 5 (Derived deterministically)                                            |

---

## 2. Inviolable Safety Guarantees

1. **No Baseline Loss**: Baselines and their referenced requirement revisions (`requirement_revisions`) CANNOT be deleted or pruned by any retention job.
2. **Lineage Integrity**: Revisions supersede previous revisions forming an unbroken directed acyclic graph (DAG). Retention cleanup never severs historical provenance.
3. **Payload Consistency**: Blob storage references (`payload_ref`) for immutable source revisions and baseline projections are checksum-verified and immutable.
4. **Executable Safety Attestation**: Every run of `RetentionLifecycleManager` executes `verifyRetentionSafety()`, taking a cryptographic row count snapshot of Class A tables (`baselines`, `source_revisions`, `requirement_revisions`, `reconciliation_records`) before and after pruning, raising `RetentionSafetyViolationError` if any Class A records are modified or pruned.
5. **Idempotent Pruning**: Retention pruning commands are idempotent and report exact record counts and blob deletion summaries.
6. **Backlog Export Mappings Conservation**: Backlog export mappings (`backlog_export_mappings`) link internal requirements baselines and user stories to external issue trackers. They are classified as Class B retained state, preserved for the product lifecycle, backed up in `manifest.json` by `BackupService` (`BACKUP_TABLES`), truncated in strict reverse-foreign-key dependency order by `RestoreService` (deleted prior to `stories` and `baselines`), restored transactionally, and verified post-restore via `RestoreVerificationResult.verifiedBacklogExportMappings`.

---

## 3. Retention Management Automation

The `RetentionLifecycleManager` service and corresponding CLI script (`scripts/run-retention-cleanup.ts`) implement automated two-horizon pruning for Class C and Class D records:

```bash
# Run retention cleanup (dry run by default)
pnpm --filter @solutions-studio/orchestrator exec tsx scripts/run-retention-cleanup.ts --dry-run

# Execute retention pruning with explicit horizons
pnpm --filter @solutions-studio/orchestrator exec tsx scripts/run-retention-cleanup.ts --max-fixture-age-days 14 --max-summary-age-days 90 --keep-last 10
```

### Configurable Thresholds:

- `maxRawFixtureAgeDays`: Horizon 1: Maximum age in days before large evaluation run raw fixture report blobs and result payloads are pruned (default: 14 days). Evaluation summary rows with aggregate scores are preserved.
- `maxEvaluationRunSummaryAgeDays`: Horizon 2: Maximum age in days before evaluation run summary metrics rows are eligible for deletion (default: 90 days).
- `keepLastEvaluationRuns`: Minimum count of recent evaluation runs guaranteed to be preserved in summary metrics regardless of age (default: 10 runs).
- `pruneTransientProjections`: Whether to prune unreferenced projections not attached to any active baseline or story (default: true).
