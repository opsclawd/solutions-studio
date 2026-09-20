import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GovernanceAuditSection } from '../../src/features/handoff/components/GovernanceAuditSection';
import { createInstant } from '@solutions-studio/domain';
import type {
  CandidatePromotionStatusDto,
  ValidationRunRecordDto,
  CandidateApprovalRecordDto
} from '@solutions-studio/contracts';

describe('GovernanceAuditSection Component', () => {
  const candidateSha = 'd5adf81ac2ba5acd7b7cd22c830f03e2258a63b4';
  const artifactHash = 'a'.repeat(64);
  const evidenceDigest = 'b'.repeat(64);

  const sampleRun: ValidationRunRecordDto = {
    id: 'RUN-P3-100',
    candidateSha,
    phase: 'phase-3',
    executionMode: 'deterministic-ci',
    provider: 'fake',
    artifacts: [
      {
        name: 'schema-ddl.sql',
        artifactType: 'sql-ddl',
        contentHash: artifactHash
      },
      {
        name: 'openapi-spec.json',
        artifactType: 'openapi-spec',
        contentHash: 'c'.repeat(64)
      }
    ],
    evidenceDigest,
    proposedDisposition: 'GO',
    executedBy: 'runner:ci',
    executedAt: createInstant('2026-09-20T08:00:00.000Z'),
    summary: { steps: 15 }
  };

  const sampleApproval: CandidateApprovalRecordDto = {
    id: 'APPR-100',
    candidateSha,
    validationRunId: 'RUN-P3-100',
    evidenceDigest,
    decision: 'GO',
    status: 'ACTIVE',
    rationale: 'Verified all 15 deterministic exit gate steps passed cleanly.',
    actor: {
      id: 'alice-lead',
      name: 'Alice Reviewer',
      email: 'alice@example.com',
      actorType: 'human'
    },
    decidedAt: createInstant('2026-09-20T08:15:00.000Z')
  };

  it('renders unapproved status banner, awaiting approval diagnostic, and decision form', () => {
    const unapprovedStatus: CandidatePromotionStatusDto = {
      candidateSha,
      isApproved: false,
      disposition: 'UNAPPROVED',
      diagnosticCode: 'AWAITING_APPROVAL',
      message: 'Candidate SHA has not been approved by an authenticated human reviewer.',
      validationRun: sampleRun,
      evaluatedAt: createInstant('2026-09-20T08:05:00.000Z')
    };

    const html = renderToStaticMarkup(
      React.createElement(GovernanceAuditSection, {
        candidateSha,
        promotionStatus: unapprovedStatus,
        validationRuns: [sampleRun],
        approvals: [],
        isLoading: false,
        error: null,
        onApprove: vi.fn(),
        onRevoke: vi.fn(),
        onExportAudit: vi.fn(),
        onRefresh: vi.fn()
      })
    );

    expect(html).toContain('data-testid="governance-audit-section"');
    expect(html).toContain('PROMOTION STATUS: UNAPPROVED');
    expect(html).toContain('AWAITING_APPROVAL');
    expect(html).toContain('data-testid="export-audit-btn"');
    expect(html).toContain('Sign &amp; Approve Promotion');
    expect(html).toContain('schema-ddl.sql');
    expect(html).toContain(evidenceDigest);
  });

  it('renders approved promotion readiness banner with active human reviewer attestation', () => {
    const approvedStatus: CandidatePromotionStatusDto = {
      candidateSha,
      isApproved: true,
      disposition: 'APPROVED',
      diagnosticCode: 'PROMOTION_READY',
      message: 'Candidate is promotion-ready with active human GO approval.',
      validationRun: sampleRun,
      activeApproval: sampleApproval,
      evaluatedAt: createInstant('2026-09-20T08:20:00.000Z')
    };

    const html = renderToStaticMarkup(
      React.createElement(GovernanceAuditSection, {
        candidateSha,
        promotionStatus: approvedStatus,
        validationRuns: [sampleRun],
        approvals: [sampleApproval],
        isLoading: false,
        error: null,
        onApprove: vi.fn(),
        onRevoke: vi.fn(),
        onExportAudit: vi.fn(),
        onRefresh: vi.fn()
      })
    );

    expect(html).toContain('PROMOTION STATUS: APPROVED (RELEASE READY)');
    expect(html).toContain('PROMOTION_READY');
    expect(html).toContain('data-testid="active-approval-card"');
    expect(html).toContain('Alice Reviewer');
    expect(html).toContain('alice@example.com');
    expect(html).toContain('Verified all 15 deterministic exit gate steps passed cleanly.');
    expect(html).toContain('Revoke Approval');
    expect(html).toContain('Governance Decision Audit Trail (1)');
  });

  it('renders candidate SHA selector input when onCandidateShaChange is provided', () => {
    const html = renderToStaticMarkup(
      React.createElement(GovernanceAuditSection, {
        candidateSha,
        promotionStatus: null,
        validationRuns: [],
        approvals: [],
        isLoading: false,
        error: null,
        onCandidateShaChange: vi.fn(),
        onApprove: vi.fn(),
        onRevoke: vi.fn(),
        onExportAudit: vi.fn(),
        onRefresh: vi.fn()
      })
    );

    expect(html).toContain('data-testid="candidate-sha-bar"');
    expect(html).toContain('data-testid="candidate-sha-input"');
    expect(html).toContain(candidateSha);
  });

  it('displays warning and disables approval when candidate SHA is missing', () => {
    const html = renderToStaticMarkup(
      React.createElement(GovernanceAuditSection, {
        candidateSha: '',
        promotionStatus: null,
        validationRuns: [],
        approvals: [],
        isLoading: false,
        error: null,
        onCandidateShaChange: vi.fn(),
        onApprove: vi.fn(),
        onRevoke: vi.fn(),
        onExportAudit: vi.fn(),
        onRefresh: vi.fn()
      })
    );

    expect(html).toContain('data-testid="candidate-sha-missing-warning"');
    expect(html).toContain('Candidate commit SHA required before approval can be recorded.');
  });
});
