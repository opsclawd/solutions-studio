'use client';

import React, { useState } from 'react';
import type {
  CandidatePromotionStatusDto,
  ValidationRunRecordDto,
  CandidateApprovalRecordDto
} from '@solutions-studio/contracts';

export interface GovernanceAuditSectionProps {
  readonly candidateSha: string;
  readonly promotionStatus: CandidatePromotionStatusDto | null;
  readonly validationRuns: readonly ValidationRunRecordDto[];
  readonly approvals: readonly CandidateApprovalRecordDto[];
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly onCandidateShaChange?: (sha: string) => void;
  readonly onApprove: (decision: 'GO' | 'DESIGN_CHANGE', rationale: string) => Promise<void>;
  readonly onRevoke: (approvalId: string, rationale: string) => Promise<void>;
  readonly onExportAudit: () => Promise<void>;
  readonly onRefresh: () => void;
}

export function GovernanceAuditSection({
  candidateSha,
  promotionStatus,
  validationRuns,
  approvals,
  isLoading,
  error,
  onCandidateShaChange,
  onApprove,
  onRevoke,
  onExportAudit,
  onRefresh
}: GovernanceAuditSectionProps) {
  const [decision, setDecision] = useState<'GO' | 'DESIGN_CHANGE'>('GO');
  const [rationale, setRationale] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [revokingApprovalId, setRevokingApprovalId] = useState<string | null>(null);
  const [revokeRationale, setRevokeRationale] = useState('');
  const [isRevoking, setIsRevoking] = useState(false);

  const [copiedDigest, setCopiedDigest] = useState(false);

  const isApproved = promotionStatus?.isApproved ?? false;
  const activeApproval =
    promotionStatus?.activeApproval ?? approvals.find((a) => a.status === 'ACTIVE');
  const latestRun = promotionStatus?.validationRun ?? validationRuns[0];

  const handleApproveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rationale.trim()) {
      setActionError('Rationale is required for human governance decisions.');
      return;
    }
    setActionError(null);
    setIsSubmitting(true);
    try {
      await onApprove(decision, rationale.trim());
      setRationale('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to record approval');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevokeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revokingApprovalId || !revokeRationale.trim()) {
      return;
    }
    setIsRevoking(true);
    try {
      await onRevoke(revokingApprovalId, revokeRationale.trim());
      setRevokingApprovalId(null);
      setRevokeRationale('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to revoke approval');
    } finally {
      setIsRevoking(false);
    }
  };

  const handleCopyDigest = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedDigest(true);
    setTimeout(() => setCopiedDigest(false), 2000);
  };

  return (
    <div data-testid="governance-audit-section" className="space-y-6">
      {/* Candidate SHA Selector / Status Bar */}
      <div
        data-testid="candidate-sha-bar"
        className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-gray-700">Target Candidate Commit SHA:</span>
          {onCandidateShaChange ? (
            <input
              type="text"
              data-testid="candidate-sha-input"
              value={candidateSha}
              onChange={(e) => onCandidateShaChange(e.target.value.trim())}
              placeholder="Enter candidate commit SHA (40-hex)..."
              className="text-xs font-mono px-3 py-1.5 border border-gray-300 rounded-lg w-72 md:w-96 focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
            />
          ) : (
            <span
              data-testid="candidate-sha-display"
              className="text-xs font-mono font-bold text-gray-900 bg-gray-100 px-2 py-1 rounded"
            >
              {candidateSha || 'No Candidate SHA specified'}
            </span>
          )}
        </div>
        {!candidateSha ? (
          <span
            data-testid="candidate-sha-missing-warning"
            className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-md font-medium"
          >
            No candidate SHA specified. Governance operations disabled.
          </span>
        ) : (
          <span className="text-2xs font-mono text-gray-500">SHA: {candidateSha.slice(0, 12)}</span>
        )}
      </div>

      {/* Promotion Status Banner */}
      <div
        data-testid="promotion-status-card"
        className={`rounded-xl border p-5 shadow-xs transition ${
          isApproved
            ? 'bg-emerald-50/70 border-emerald-300'
            : promotionStatus?.disposition === 'DESIGN_CHANGE_REQUIRED'
              ? 'bg-red-50/70 border-red-300'
              : 'bg-amber-50/70 border-amber-300'
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                isApproved
                  ? 'bg-emerald-600 text-white'
                  : promotionStatus?.disposition === 'DESIGN_CHANGE_REQUIRED'
                    ? 'bg-red-600 text-white'
                    : 'bg-amber-600 text-white'
              }`}
            >
              {isApproved ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-gray-900">
                  {isApproved
                    ? 'PROMOTION STATUS: APPROVED (RELEASE READY)'
                    : `PROMOTION STATUS: ${promotionStatus?.disposition ?? 'UNAPPROVED'}`}
                </h3>
                <span
                  data-testid="promotion-diagnostic-badge"
                  className={`text-xs px-2.5 py-0.5 rounded-full font-mono font-bold ${
                    isApproved ? 'bg-emerald-200 text-emerald-900' : 'bg-amber-200 text-amber-900'
                  }`}
                >
                  {promotionStatus?.diagnosticCode ?? 'AWAITING_APPROVAL'}
                </span>
              </div>
              <p className="text-xs text-gray-700 mt-1 max-w-3xl">
                {promotionStatus?.message ??
                  'Candidate release requires cryptographic verification of evidence artifacts and sign-off by an authenticated human reviewer.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              data-testid="export-audit-btn"
              onClick={onExportAudit}
              disabled={!candidateSha || isLoading}
              className="px-3.5 py-2 text-xs font-semibold bg-white text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50 shadow-xs transition flex items-center gap-1.5 disabled:opacity-50"
            >
              <svg
                className="w-4 h-4 text-gray-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              <span>Export Audit Package</span>
            </button>
            <button
              type="button"
              data-testid="refresh-governance-btn"
              onClick={onRefresh}
              disabled={isLoading}
              className="p-2 text-gray-600 hover:text-gray-900 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-xs transition disabled:opacity-50"
              title="Refresh governance state"
            >
              <svg
                className={`w-4 h-4 ${isLoading ? 'animate-spin text-indigo-600' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
          <strong>Error loading governance state:</strong> {error}
        </div>
      )}

      {actionError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
          <strong>Action Failed:</strong> {actionError}
        </div>
      )}

      {/* Grid: Active Attestation / Sign-off Form & Evidence Run */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Human Approval Attestation / Decision Box */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-xs space-y-5">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3">
            <h4 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <span>Human Reviewer Attestation</span>
              <span className="text-2xs uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-mono font-semibold">
                candidate:approve
              </span>
            </h4>
            {activeApproval && (
              <span className="text-2xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                ACTIVE
              </span>
            )}
          </div>

          {activeApproval ? (
            <div data-testid="active-approval-card" className="space-y-4">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs">
                      {activeApproval.actor.name.charAt(0)}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-gray-900">
                        {activeApproval.actor.name}
                      </div>
                      <div className="text-2xs text-gray-500 font-mono">
                        {activeApproval.actor.email ?? activeApproval.actor.id} (
                        {activeApproval.actor.actorType})
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded ${
                        activeApproval.decision === 'GO'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {activeApproval.decision}
                    </span>
                    <div className="text-2xs text-gray-400 mt-0.5 font-mono">
                      {new Date(activeApproval.decidedAt).toLocaleString()}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-2xs font-semibold text-gray-500 uppercase tracking-wider">
                    Reviewer Rationale
                  </div>
                  <p className="text-xs text-gray-800 mt-1 italic bg-white p-2.5 rounded border border-gray-200">
                    "{activeApproval.rationale}"
                  </p>
                </div>

                <div className="flex items-center justify-between text-2xs text-gray-500 font-mono pt-1">
                  <span>Approval ID: {activeApproval.id}</span>
                  <button
                    type="button"
                    onClick={() => setRevokingApprovalId(activeApproval.id)}
                    className="text-red-600 hover:text-red-800 font-sans font-semibold underline"
                  >
                    Revoke Approval
                  </button>
                </div>
              </div>

              {revokingApprovalId && (
                <form
                  onSubmit={handleRevokeSubmit}
                  className="bg-red-50/50 border border-red-200 rounded-lg p-4 space-y-3"
                >
                  <h5 className="text-xs font-bold text-red-900">Revoke Promotion Approval</h5>
                  <p className="text-2xs text-red-700">
                    Revoking this approval immediately transitions promotion status to UNAPPROVED
                    and halts release pipelines.
                  </p>
                  <textarea
                    value={revokeRationale}
                    onChange={(e) => setRevokeRationale(e.target.value)}
                    placeholder="Mandatory revocation rationale (e.g. regression detected in production testing)..."
                    rows={2}
                    required
                    className="w-full text-xs p-2 rounded border border-red-300 bg-white text-gray-900 focus:ring-2 focus:ring-red-500 focus:outline-hidden"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setRevokingApprovalId(null)}
                      className="px-3 py-1 text-xs text-gray-600 hover:text-gray-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isRevoking}
                      className="px-3 py-1 bg-red-600 text-white rounded text-xs font-semibold hover:bg-red-700 disabled:opacity-50"
                    >
                      {isRevoking ? 'Revoking...' : 'Confirm Revocation'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          ) : (
            <form onSubmit={handleApproveSubmit} className="space-y-4">
              <p className="text-xs text-gray-600">
                Record an authenticated human approval cryptographically bound to the current
                candidate SHA and validation evidence digest.
              </p>

              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">
                  Decision Disposition
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-xs font-medium text-gray-800 cursor-pointer">
                    <input
                      type="radio"
                      name="decision"
                      value="GO"
                      checked={decision === 'GO'}
                      onChange={() => setDecision('GO')}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="font-bold text-emerald-700">GO (Approve for Release)</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs font-medium text-gray-800 cursor-pointer">
                    <input
                      type="radio"
                      name="decision"
                      value="DESIGN_CHANGE"
                      checked={decision === 'DESIGN_CHANGE'}
                      onChange={() => setDecision('DESIGN_CHANGE')}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="font-bold text-red-700">DESIGN CHANGE (Reject)</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">
                  Audit Rationale / Justification
                </label>
                <textarea
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  placeholder="State evidence reviewed, verification results, and justification for sign-off..."
                  rows={3}
                  required
                  className="w-full text-xs p-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting || !latestRun || !candidateSha}
                  className="w-full py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 shadow-xs transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Recording Sign-off...</span>
                    </>
                  ) : (
                    <span>Sign & Approve Promotion</span>
                  )}
                </button>
                {!candidateSha ? (
                  <p className="text-2xs text-amber-600 mt-1 text-center">
                    Candidate commit SHA required before approval can be recorded.
                  </p>
                ) : !latestRun ? (
                  <p className="text-2xs text-amber-600 mt-1 text-center">
                    Validation run required before approval can be recorded.
                  </p>
                ) : null}
              </div>
            </form>
          )}
        </div>

        {/* Right Column: Evidence Digest & Validation Run Artifacts */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3">
            <h4 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <span>Validation Run Evidence</span>
              {latestRun && (
                <span className="text-2xs px-2 py-0.5 rounded bg-gray-100 text-gray-700 font-mono">
                  {latestRun.phase}
                </span>
              )}
            </h4>
            {latestRun && (
              <span className="text-2xs font-mono text-gray-500">
                {new Date(latestRun.executedAt).toLocaleString()}
              </span>
            )}
          </div>

          {latestRun ? (
            <div className="space-y-4">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 font-medium">Validation Run ID:</span>
                  <span className="font-mono font-semibold text-gray-900">{latestRun.id}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 font-medium">Candidate Commit SHA:</span>
                  <span className="font-mono font-semibold text-indigo-700">
                    {latestRun.candidateSha.slice(0, 12)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 font-medium">Execution Mode:</span>
                  <span className="font-mono text-gray-700">
                    {latestRun.executionMode} ({latestRun.provider})
                  </span>
                </div>
                <div className="pt-2 border-t border-gray-200">
                  <div className="flex items-center justify-between">
                    <span className="text-2xs font-semibold uppercase text-gray-500">
                      Evidence Digest (SHA-256):
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyDigest(latestRun.evidenceDigest)}
                      className="text-2xs text-indigo-600 hover:text-indigo-800 font-semibold"
                    >
                      {copiedDigest ? 'Copied!' : 'Copy Hash'}
                    </button>
                  </div>
                  <div className="text-2xs font-mono bg-white p-2 rounded border border-gray-200 mt-1 break-all text-gray-800">
                    {latestRun.evidenceDigest}
                  </div>
                </div>
              </div>

              <div>
                <h5 className="text-xs font-bold text-gray-800 mb-2">
                  Verified Artifacts ({latestRun.artifacts.length})
                </h5>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {latestRun.artifacts.map((art, idx) => (
                    <div
                      key={idx}
                      className="text-xs bg-gray-50 border border-gray-200 rounded-md p-2 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 truncate">{art.name}</div>
                        <div className="text-2xs text-gray-500 font-mono">{art.artifactType}</div>
                      </div>
                      <div className="text-2xs font-mono text-gray-600 shrink-0 bg-white px-1.5 py-0.5 rounded border border-gray-200">
                        {art.contentHash.slice(0, 10)}...{art.contentHash.slice(-8)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-gray-500 space-y-2">
              <svg
                className="w-8 h-8 mx-auto text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <p className="text-xs">
                No validation runs recorded for candidate SHA {candidateSha.slice(0, 10)}.
              </p>
              <p className="text-2xs text-gray-400">
                Run the Phase 3 exit gate script to record validation evidence.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Approval History Timeline */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-xs space-y-4">
        <h4 className="text-sm font-bold text-gray-900">
          Governance Decision Audit Trail ({approvals.length})
        </h4>
        {approvals.length === 0 ? (
          <p className="text-xs text-gray-500 italic">
            No governance approval records found for this candidate SHA.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/50">
                  <th className="py-2.5 px-3 font-semibold text-gray-700">Approval ID</th>
                  <th className="py-2.5 px-3 font-semibold text-gray-700">Reviewer</th>
                  <th className="py-2.5 px-3 font-semibold text-gray-700">Decision</th>
                  <th className="py-2.5 px-3 font-semibold text-gray-700">Status</th>
                  <th className="py-2.5 px-3 font-semibold text-gray-700">Recorded At</th>
                  <th className="py-2.5 px-3 font-semibold text-gray-700">Rationale</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {approvals.map((appr) => (
                  <tr key={appr.id} className="hover:bg-gray-50/50 transition">
                    <td className="py-2.5 px-3 font-mono text-2xs text-gray-600">{appr.id}</td>
                    <td className="py-2.5 px-3 font-medium text-gray-900">{appr.actor.name}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-2xs font-bold ${
                          appr.decision === 'GO'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {appr.decision}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-2xs font-mono font-semibold ${
                          appr.status === 'ACTIVE'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : appr.status === 'REVOKED'
                              ? 'bg-red-50 text-red-700 border border-red-200'
                              : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {appr.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-2xs text-gray-500">
                      {new Date(appr.decidedAt).toLocaleString()}
                    </td>
                    <td
                      className="py-2.5 px-3 text-gray-600 max-w-md truncate"
                      title={appr.rationale}
                    >
                      {appr.rationale}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
