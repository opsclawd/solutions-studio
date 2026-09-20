-- Migration 003: Governance Audit & Promotion Integrity Schema

CREATE TABLE IF NOT EXISTS validation_runs (
    id VARCHAR(255) PRIMARY KEY,
    candidate_sha VARCHAR(255) NOT NULL,
    executed_at TIMESTAMPTZ NOT NULL,
    executed_by VARCHAR(255) NOT NULL,
    phase VARCHAR(64) NOT NULL,
    execution_mode VARCHAR(64) NOT NULL,
    provider VARCHAR(255) NOT NULL,
    model VARCHAR(255),
    artifacts JSONB NOT NULL,
    evidence_digest VARCHAR(64) NOT NULL,
    proposed_disposition VARCHAR(64),
    summary JSONB NOT NULL DEFAULT '{}',
    payload_ref VARCHAR(512),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_artifacts_non_empty CHECK (jsonb_array_length(artifacts) > 0)
);

CREATE INDEX IF NOT EXISTS idx_validation_runs_candidate_sha ON validation_runs(candidate_sha);
CREATE INDEX IF NOT EXISTS idx_validation_runs_executed_at ON validation_runs(executed_at DESC);

CREATE TABLE IF NOT EXISTS governance_approvals (
    id VARCHAR(255) PRIMARY KEY,
    candidate_sha VARCHAR(255) NOT NULL,
    validation_run_id VARCHAR(255) NOT NULL REFERENCES validation_runs(id),
    evidence_digest VARCHAR(64) NOT NULL,
    decision VARCHAR(64) NOT NULL,
    actor_id VARCHAR(255) NOT NULL,
    actor_name VARCHAR(255) NOT NULL,
    actor_email VARCHAR(255),
    actor_type VARCHAR(64) NOT NULL,
    decided_at TIMESTAMPTZ NOT NULL,
    rationale TEXT NOT NULL,
    supersedes VARCHAR(255) REFERENCES governance_approvals(id),
    status VARCHAR(64) NOT NULL DEFAULT 'ACTIVE',
    revocation JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_actor_type_human CHECK (actor_type = 'human'),
    CONSTRAINT chk_decision_enum CHECK (decision IN ('GO', 'DESIGN_CHANGE')),
    CONSTRAINT chk_status_enum CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'REVOKED')),
    CONSTRAINT chk_revocation_conditional CHECK (
        (status = 'REVOKED' AND revocation IS NOT NULL) OR
        (status IN ('ACTIVE', 'SUPERSEDED') AND revocation IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_governance_approvals_candidate_sha ON governance_approvals(candidate_sha);
CREATE INDEX IF NOT EXISTS idx_governance_approvals_validation_run_id ON governance_approvals(validation_run_id);
CREATE INDEX IF NOT EXISTS idx_governance_approvals_status ON governance_approvals(status);

-- Partial unique index ensuring at most ONE active approval per candidate SHA
CREATE UNIQUE INDEX IF NOT EXISTS idx_governance_approvals_active_candidate
    ON governance_approvals (candidate_sha)
    WHERE status = 'ACTIVE';
