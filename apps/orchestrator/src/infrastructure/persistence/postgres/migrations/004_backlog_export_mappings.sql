-- Migration 004: Backlog Export Mappings Schema

CREATE TABLE IF NOT EXISTS backlog_export_mappings (
    id VARCHAR(255) PRIMARY KEY,
    story_id VARCHAR(255) NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    baseline_id VARCHAR(255) NOT NULL REFERENCES baselines(id) ON DELETE CASCADE,
    provider VARCHAR(64) NOT NULL,
    external_container VARCHAR(255) NOT NULL,
    external_work_item_id VARCHAR(255) NOT NULL,
    external_url VARCHAR(512),
    export_content_hash VARCHAR(64) NOT NULL,
    exported_at TIMESTAMPTZ NOT NULL,
    exported_by VARCHAR(255) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_backlog_mapping UNIQUE (provider, external_container, story_id)
);

CREATE INDEX IF NOT EXISTS idx_backlog_export_mappings_baseline_id ON backlog_export_mappings(baseline_id);
CREATE INDEX IF NOT EXISTS idx_backlog_export_mappings_story_id ON backlog_export_mappings(story_id);
CREATE INDEX IF NOT EXISTS idx_backlog_export_mappings_provider_container ON backlog_export_mappings(provider, external_container);
