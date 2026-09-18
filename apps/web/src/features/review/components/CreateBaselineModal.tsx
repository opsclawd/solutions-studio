'use client';

import React, { useState } from 'react';
import type { RequirementRevisionDto, CandidateFindingDto } from '@solutions-studio/contracts';

export interface CreateBaselineModalProps {
  currentBaselineId?: string;
  requirementRevisions: readonly RequirementRevisionDto[];
  findings: readonly CandidateFindingDto[];
  actorId?: string;
  onSubmit: (params: {
    id: string;
    requirementRevisions: string[];
    createdBy: string;
  }) => Promise<void>;
  onCancel: () => void;
}

export function CreateBaselineModal({
  currentBaselineId,
  requirementRevisions,
  findings,
  actorId,
  onSubmit,
  onCancel
}: CreateBaselineModalProps) {
  const defaultNextId = currentBaselineId
    ? currentBaselineId.replace(/(\d+)$/, (match) =>
        String(Number(match) + 1).padStart(match.length, '0')
      )
    : 'BASE-002';

  const [baselineId, setBaselineId] = useState(
    defaultNextId !== currentBaselineId ? defaultNextId : 'BASE-002'
  );
  const [createdBy, setCreatedBy] = useState(actorId || 'lead-reviewer');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligibleRevisions = requirementRevisions.filter(
    (r) => r.reviewState === 'ACCEPTED' && r.resolutionState === 'CLEAR'
  );
  const ineligibleRevisions = requirementRevisions.filter(
    (r) => r.reviewState !== 'ACCEPTED' || r.resolutionState !== 'CLEAR'
  );

  const eligibleRevIds = new Set(eligibleRevisions.map((r) => r.id));
  const openBlockingFindings = findings.filter(
    (f) =>
      f.disposition === 'OPEN' &&
      f.affectedRequirementRevisions.some((revId) => eligibleRevIds.has(revId))
  );

  const hasValidationIssues = ineligibleRevisions.length > 0 || openBlockingFindings.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!baselineId.trim() || !createdBy.trim() || eligibleRevisions.length === 0) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await onSubmit({
        id: baselineId.trim(),
        requirementRevisions: eligibleRevisions.map((r) => r.id),
        createdBy: createdBy.trim()
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create successor baseline');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      data-testid="create-baseline-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
    >
      <div
        data-testid="create-baseline-modal"
        className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900">Create Successor Baseline</h2>
          <button
            type="button"
            data-testid="cancel-create-baseline-btn"
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600 font-bold"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          {error && (
            <div
              data-testid="create-baseline-error"
              className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-xs"
            >
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">
              Predecessor Baseline
            </label>
            <div
              data-testid="predecessor-baseline-id"
              className="font-mono text-xs font-bold text-gray-800 bg-gray-100 px-3 py-2 rounded-lg"
            >
              {currentBaselineId || 'None (Initial baseline creation)'}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Successor Baseline ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              data-testid="create-baseline-id-input"
              value={baselineId}
              onChange={(e) => setBaselineId(e.target.value)}
              className="w-full text-xs font-mono p-2.5 border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-hidden"
              placeholder="e.g. BASE-002"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Created By (Reviewer ID) <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              data-testid="create-baseline-creator-input"
              value={createdBy}
              onChange={(e) => setCreatedBy(e.target.value)}
              className="w-full text-xs p-2.5 border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-hidden"
              placeholder="e.g. lead-reviewer"
              required
            />
          </div>

          {hasValidationIssues && (
            <div
              data-testid="baseline-validation-warning"
              className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs space-y-1.5"
            >
              <div className="font-bold flex items-center gap-1.5">
                <span>⚠</span>
                <span>Unresolved Requirements or Open Findings in Scope</span>
              </div>
              {ineligibleRevisions.length > 0 && (
                <p>
                  {ineligibleRevisions.length} requirement revision(s) are not accepted or clear and
                  will be excluded from the new baseline:{' '}
                  <span className="font-mono font-semibold">
                    {ineligibleRevisions.map((r) => r.id).join(', ')}
                  </span>
                </p>
              )}
              {openBlockingFindings.length > 0 && (
                <p className="text-red-700 font-semibold">
                  Warning: {openBlockingFindings.length} open finding(s) affect eligible revisions.
                  Creating a baseline may be blocked until findings are dispositioned.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              Revisions Included in Successor Baseline ({eligibleRevisions.length})
            </label>
            <div
              data-testid="create-baseline-revisions-preview"
              className="border border-gray-200 rounded-lg p-3 bg-gray-50 max-h-40 overflow-y-auto space-y-1 text-xs"
            >
              {eligibleRevisions.length === 0 ? (
                <div className="text-gray-400 italic">
                  No eligible revisions (must be ACCEPTED and CLEAR).
                </div>
              ) : (
                eligibleRevisions.map((rev) => (
                  <div
                    key={rev.id}
                    data-testid={`baseline-preview-rev-${rev.id}`}
                    className="flex items-center justify-between font-mono bg-white px-2.5 py-1.5 rounded border border-gray-200"
                  >
                    <span className="font-bold text-gray-800">{rev.id}</span>
                    <span className="text-[11px] text-gray-500 truncate max-w-[200px]">
                      {rev.statement}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-200">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-xs font-medium text-gray-700 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="submit-create-baseline-btn"
              disabled={
                !baselineId.trim() ||
                !createdBy.trim() ||
                eligibleRevisions.length === 0 ||
                isSubmitting
              }
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition shadow-xs"
            >
              {isSubmitting ? 'Creating Baseline...' : 'Freeze Successor Baseline'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
