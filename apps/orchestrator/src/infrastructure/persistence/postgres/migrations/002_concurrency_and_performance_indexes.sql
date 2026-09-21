-- Migration 002: Concurrency & Performance Indexes
-- Creates secondary indexes for OCC filters, audit queries, foreign keys, and baseline lookups

CREATE INDEX IF NOT EXISTS idx_candidate_findings_disposition ON candidate_findings(disposition);
CREATE INDEX IF NOT EXISTS idx_candidate_findings_baseline_id ON candidate_findings(baseline_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_records_lookup ON reconciliation_records(entity_type, entity_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_requirement_revisions_req_rev ON requirement_revisions(requirement_id, revision);
CREATE INDEX IF NOT EXISTS idx_source_revisions_src_rev ON source_revisions(source_id, revision);
CREATE INDEX IF NOT EXISTS idx_policy_constraint_revisions_pol_rev ON policy_constraint_revisions(policy_constraint_id, revision);
CREATE INDEX IF NOT EXISTS idx_engineering_decisions_baseline_state ON engineering_decisions(baseline_id, state);
CREATE INDEX IF NOT EXISTS idx_projections_baseline_id ON projections(baseline_id);
CREATE INDEX IF NOT EXISTS idx_stories_baseline_id ON stories(baseline_id);
CREATE INDEX IF NOT EXISTS idx_stories_projection_id ON stories(projection_id);
