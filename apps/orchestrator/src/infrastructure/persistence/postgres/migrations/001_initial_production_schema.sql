-- Migration 001: Initial Production Schema
-- Creates core domain entities with foreign keys, checks, and version columns

CREATE TABLE IF NOT EXISTS schema_migrations (
    version INT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sources (
    id VARCHAR(255) PRIMARY KEY,
    source_type VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS source_revisions (
    id VARCHAR(255) PRIMARY KEY,
    source_id VARCHAR(255) NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    revision INT NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ,
    supersedes VARCHAR(255),
    source_type VARCHAR(64),
    raw_text TEXT,
    payload_ref VARCHAR(512),
    locator_index JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_source_revision UNIQUE (source_id, revision)
);

CREATE TABLE IF NOT EXISTS requirements (
    id VARCHAR(255) PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS requirement_revisions (
    id VARCHAR(255) PRIMARY KEY,
    requirement_id VARCHAR(255) NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
    revision INT NOT NULL,
    statement TEXT NOT NULL,
    category VARCHAR(64) NOT NULL,
    origin VARCHAR(64) NOT NULL,
    review_state VARCHAR(64) NOT NULL,
    resolution_state VARCHAR(64) NOT NULL,
    evidence JSONB NOT NULL DEFAULT '[]',
    rationale TEXT NOT NULL,
    actor_id VARCHAR(255),
    baseline_id VARCHAR(255),
    originating_projection_id VARCHAR(255),
    affected_actors JSONB,
    dependencies JSONB,
    supersedes VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_requirement_revision UNIQUE (requirement_id, revision)
);

CREATE TABLE IF NOT EXISTS candidate_findings (
    id VARCHAR(255) PRIMARY KEY,
    type VARCHAR(64) NOT NULL,
    affected_requirement_revisions JSONB NOT NULL DEFAULT '[]',
    evidence JSONB NOT NULL DEFAULT '[]',
    discovered_by VARCHAR(64) NOT NULL,
    disposition VARCHAR(64) NOT NULL,
    rationale TEXT,
    actor_id VARCHAR(255),
    baseline_id VARCHAR(255),
    originating_projection_id VARCHAR(255),
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reconciliation_records (
    id VARCHAR(255) PRIMARY KEY,
    entity_type VARCHAR(64) NOT NULL,
    entity_id VARCHAR(255) NOT NULL,
    requirement_revision_id VARCHAR(255),
    action VARCHAR(64),
    previous_review_state VARCHAR(64),
    new_review_state VARCHAR(64),
    previous_resolution_state VARCHAR(64),
    new_resolution_state VARCHAR(64),
    previous_disposition VARCHAR(64),
    new_disposition VARCHAR(64),
    rationale TEXT NOT NULL,
    actor_id VARCHAR(255),
    recorded_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS baselines (
    id VARCHAR(255) PRIMARY KEY,
    requirement_revisions JSONB NOT NULL,
    policy_constraint_revisions JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL,
    created_by VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS policy_constraints (
    id VARCHAR(255) PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS policy_constraint_revisions (
    id VARCHAR(255) PRIMARY KEY,
    policy_constraint_id VARCHAR(255) NOT NULL REFERENCES policy_constraints(id) ON DELETE CASCADE,
    revision INT NOT NULL,
    statement TEXT NOT NULL,
    authority_reference VARCHAR(512) NOT NULL,
    state VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    supersedes VARCHAR(255),
    CONSTRAINT uq_policy_constraint_revision UNIQUE (policy_constraint_id, revision)
);

CREATE TABLE IF NOT EXISTS engineering_decisions (
    id VARCHAR(255) PRIMARY KEY,
    baseline_id VARCHAR(255) NOT NULL,
    statement TEXT NOT NULL,
    rationale TEXT NOT NULL,
    requirement_revision_ids JSONB NOT NULL DEFAULT '[]',
    policy_constraint_revision_ids JSONB NOT NULL DEFAULT '[]',
    state VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    accepted_by VARCHAR(255),
    accepted_at TIMESTAMPTZ,
    supersedes VARCHAR(255),
    transition_rationale TEXT,
    version INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projections (
    id VARCHAR(255) PRIMARY KEY,
    baseline_id VARCHAR(255) NOT NULL,
    requirement_revision_ids JSONB NOT NULL DEFAULT '[]',
    policy_constraint_revision_ids JSONB,
    engineering_decision_ids JSONB,
    artifact_type VARCHAR(64) NOT NULL,
    content TEXT NOT NULL,
    payload_ref VARCHAR(512),
    metadata JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    version INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS stories (
    id VARCHAR(255) PRIMARY KEY,
    baseline_id VARCHAR(255) NOT NULL,
    projection_id VARCHAR(255) NOT NULL,
    title VARCHAR(512) NOT NULL,
    narrative JSONB NOT NULL,
    requirement_revision_ids JSONB NOT NULL DEFAULT '[]',
    policy_constraint_revision_ids JSONB,
    scenarios JSONB NOT NULL DEFAULT '[]',
    acceptance_criteria JSONB NOT NULL DEFAULT '[]',
    gherkin_text TEXT NOT NULL,
    metadata JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    dependencies JSONB,
    version INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS evaluation_runs (
    id VARCHAR(255) PRIMARY KEY,
    corpus_version VARCHAR(64) NOT NULL,
    executed_at TIMESTAMPTZ NOT NULL,
    fixture_results JSONB NOT NULL DEFAULT '[]',
    report JSONB NOT NULL,
    payload_ref VARCHAR(512)
);
