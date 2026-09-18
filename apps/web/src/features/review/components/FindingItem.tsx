'use client';

import React, { useState } from 'react';
import type { CandidateFindingDto } from '@solutions-studio/contracts';
import type { FindingDisposition } from '@solutions-studio/domain';
import { getDispositionBadge } from './badges';

export interface FindingItemProps {
  finding: CandidateFindingDto;
  actorId?: string;
  onDisposition: (
    findingId: string,
    disposition: FindingDisposition,
    rationale: string
  ) => Promise<void>;
  onReopen: (findingId: string, rationale?: string) => Promise<void>;
  onNavigateToProjection?: (projectionId: string) => void;
  onNavigateToRequirement?: (requirementId: string) => void;
  getRequirementIdForRevision?: (revId: string) => string | undefined;
}

export function FindingItem({
  finding,
  actorId: _actorId,
  onDisposition,
  onReopen,
  onNavigateToProjection,
  onNavigateToRequirement,
  getRequirementIdForRevision
}: FindingItemProps) {
  const [isActing, setIsActing] = useState(false);
  const [selectedDisposition, setSelectedDisposition] = useState<FindingDisposition>(
    finding.disposition === 'RESOLVED' ? 'DISMISSED_FALSE_POSITIVE' : 'RESOLVED'
  );

  const [rationale, setRationale] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const badge = getDispositionBadge(finding.disposition);

  const handleApplyDisposition = async () => {
    if (!rationale.trim()) return;
    setIsSubmitting(true);
    setLocalError(null);
    try {
      await onDisposition(finding.id, selectedDisposition, rationale.trim());
      setIsActing(false);
      setRationale('');
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : 'Disposition failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReopen = async () => {
    setIsSubmitting(true);
    setLocalError(null);
    try {
      await onReopen(finding.id, rationale.trim() || undefined);
      setIsActing(false);
      setRationale('');
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : 'Reopen failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      data-testid="finding-item"
      data-finding-id={finding.id}
      className="border border-gray-200 rounded-lg p-3.5 bg-white shadow-xs text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span
            data-testid="finding-id"
            className="font-mono font-semibold text-gray-800 bg-gray-100 px-1.5 py-0.5 rounded text-[11px]"
          >
            {finding.id}
          </span>
          <span className="text-gray-500 font-medium">{finding.type}</span>
          <span className="text-[10px] text-gray-400">via {finding.discoveredBy}</span>
        </div>
        <span
          data-testid="finding-disposition-badge"
          className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${badge.className}`}
        >
          {badge.label}
        </span>
      </div>

      {finding.rationale && (
        <p data-testid="finding-rationale" className="text-gray-700 mb-2 leading-relaxed">
          {finding.rationale}
        </p>
      )}

      {finding.affectedRequirementRevisions.length > 0 && (
        <div className="text-[11px] text-gray-500 mb-2">
          <span className="font-medium">Attached Revisions: </span>
          <span className="font-mono">
            {finding.affectedRequirementRevisions.map((revId, idx) => {
              const reqId = getRequirementIdForRevision?.(revId) ?? revId;
              return (
                <span key={revId}>
                  {idx > 0 && ', '}
                  <button
                    type="button"
                    data-testid={`affected-rev-link-${revId}`}
                    onClick={() => onNavigateToRequirement?.(reqId)}
                    className="text-blue-600 hover:text-blue-800 underline font-mono cursor-pointer"
                  >
                    {revId}
                  </button>
                </span>
              );
            })}
          </span>
        </div>
      )}

      {finding.originatingProjectionId && (
        <div
          data-testid="finding-originating-projection"
          className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between text-xs text-purple-700 bg-purple-50/50 p-2 rounded"
        >
          <span>
            Discovered during review of projection:{' '}
            <strong className="font-mono">{finding.originatingProjectionId}</strong>
          </span>
          <button
            type="button"
            data-testid="finding-back-to-projection-btn"
            onClick={() => onNavigateToProjection?.(finding.originatingProjectionId!)}
            className="text-purple-600 hover:text-purple-800 font-medium underline"
          >
            View Originating Projection →
          </button>
        </div>
      )}

      {localError && (
        <div className="text-rose-700 bg-rose-50 p-2 rounded text-xs mb-2">{localError}</div>
      )}

      {!isActing ? (
        <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-end">
          <button
            type="button"
            data-testid="toggle-finding-action-btn"
            onClick={() => setIsActing(true)}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium underline"
          >
            {finding.disposition === 'OPEN' ? 'Change Disposition' : 'Reopen Finding'}
          </button>
        </div>
      ) : (
        <div className="mt-2 pt-2 border-t border-gray-100 bg-gray-50 p-3 rounded space-y-2">
          {finding.disposition === 'OPEN' ? (
            <>
              <div>
                <label className="block font-medium text-gray-700 mb-1 text-[11px]">
                  New Disposition:
                </label>
                <select
                  data-testid="finding-disposition-select"
                  value={selectedDisposition}
                  onChange={(e) => setSelectedDisposition(e.target.value as FindingDisposition)}

                  className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500"
                >
                  <option value="RESOLVED">RESOLVED</option>
                  <option value="DISMISSED_FALSE_POSITIVE">DISMISSED (FALSE POSITIVE)</option>
                  <option value="ACCEPTED_RISK">ACCEPTED RISK</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-gray-700 mb-1 text-[11px]">
                  Rationale (required):
                </label>
                <textarea
                  data-testid="finding-rationale-input"
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  placeholder="Explain why this finding is being dispositioned..."
                  rows={2}
                  className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsActing(false);
                    setRationale('');
                    setLocalError(null);
                  }}
                  className="px-2.5 py-1 text-xs text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="apply-disposition-btn"
                  disabled={!rationale.trim() || isSubmitting}
                  onClick={handleApplyDisposition}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-xs font-medium transition"
                >
                  {isSubmitting ? 'Saving...' : 'Apply Disposition'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block font-medium text-gray-700 mb-1 text-[11px]">
                  Reopen Rationale (optional):
                </label>
                <textarea
                  data-testid="reopen-rationale-input"
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  placeholder="Reason for reopening this candidate finding..."
                  rows={2}
                  className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsActing(false);
                    setRationale('');
                    setLocalError(null);
                  }}
                  className="px-2.5 py-1 text-xs text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="reopen-finding-btn"
                  disabled={isSubmitting}
                  onClick={handleReopen}
                  className="px-3 py-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-xs font-medium transition"
                >
                  {isSubmitting ? 'Reopening...' : 'Reopen Finding'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
