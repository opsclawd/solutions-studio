-- Migration 005: Backlog Export Staleness & History Schema

-- 1. Alter backlog_export_mappings to add head export version and lineage
ALTER TABLE backlog_export_mappings
    ADD COLUMN IF NOT EXISTS export_version INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS story_version INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS export_content_hash_version INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS requirement_revision_ids JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS policy_constraint_revision_ids JSONB,
    ADD COLUMN IF NOT EXISTS prerequisite_export_versions JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS history JSONB NOT NULL DEFAULT '[]';

-- 2. Create relational history audit table
CREATE TABLE IF NOT EXISTS backlog_export_history (
    id VARCHAR(255) PRIMARY KEY,
    mapping_id VARCHAR(255) NOT NULL REFERENCES backlog_export_mappings(id) ON DELETE CASCADE,
    export_version INT NOT NULL,
    baseline_id VARCHAR(255) NOT NULL REFERENCES baselines(id) ON DELETE CASCADE,
    story_id VARCHAR(255) NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    story_version INT NOT NULL,
    export_content_hash VARCHAR(64) NOT NULL,
    export_content_hash_version INT NOT NULL DEFAULT 1,
    requirement_revision_ids JSONB NOT NULL DEFAULT '[]',
    policy_constraint_revision_ids JSONB,
    prerequisite_export_versions JSONB NOT NULL DEFAULT '{}',
    exported_at TIMESTAMPTZ NOT NULL,
    exported_by VARCHAR(255) NOT NULL,
    external_work_item_id VARCHAR(255) NOT NULL,
    external_url VARCHAR(512),
    update_rationale TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_mapping_export_version UNIQUE (mapping_id, export_version)
);

CREATE INDEX IF NOT EXISTS idx_backlog_export_history_mapping_id
    ON backlog_export_history (mapping_id);
CREATE INDEX IF NOT EXISTS idx_backlog_export_history_story_id
    ON backlog_export_history (story_id);
