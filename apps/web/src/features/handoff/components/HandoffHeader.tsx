'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import type {
  EngineeringHandoffBundleDto,
  CandidatePromotionStatusDto,
  BaselineExportStalenessReportDto
} from '@solutions-studio/contracts';

export interface HandoffHeaderProps {
  readonly bundle: EngineeringHandoffBundleDto | null;
  readonly activeBaselineId: string | null;
  readonly availableBaselines: readonly string[];
  readonly candidateSha?: string;
  readonly onCandidateShaChange?: (sha: string) => void;
  readonly promotionStatus?: CandidatePromotionStatusDto | null;
  readonly stalenessReport?: BaselineExportStalenessReportDto | null;
  readonly onSelectBaseline: (baselineId: string) => void;
  readonly onRefresh: () => void;
}

export function HandoffHeader({
  bundle,
  activeBaselineId,
  availableBaselines,
  candidateSha,
  onCandidateShaChange,
  promotionStatus,
  stalenessReport,
  onSelectBaseline,
  onRefresh
}: HandoffHeaderProps) {
  const [copied, setCopied] = useState(false);

  const summary = bundle?.summary;
  const isReady = summary?.isHandoffReady ?? false;
  const hasCycles = bundle?.dependencyGraph.hasCycles ?? false;

  const handleCopyJson = () => {
    if (!bundle) return;
    navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const baselineOptions = Array.from(
    new Set([...availableBaselines, ...(activeBaselineId ? [activeBaselineId] : [])])
  );

  return (
    <header data-testid="handoff-header" className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Title and Baseline Selector */}
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
              <span>Engineering Handoff Workspace</span>
              <span className="text-xs px-2 py-0.5 rounded font-mono font-normal bg-gray-100 text-gray-600">
                Phase 3.6
              </span>
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Machine-readable contracts, story dependency DAG, and readiness audit
            </p>
          </div>

          <div className="flex items-center gap-2 border-l border-gray-200 pl-4">
            <label htmlFor="handoff-baseline-select" className="text-xs text-gray-500 font-medium">
              Baseline:
            </label>
            <select
              id="handoff-baseline-select"
              data-testid="handoff-baseline-select"
              value={activeBaselineId ?? ''}
              onChange={(e) => onSelectBaseline(e.target.value)}
              className="text-xs font-mono font-medium border border-gray-300 rounded-lg px-2.5 py-1.5 bg-white text-gray-900 shadow-xs focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
            >
              {baselineOptions.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </div>

          {candidateSha !== undefined && (
            <div className="flex items-center gap-2 border-l border-gray-200 pl-4">
              <label htmlFor="handoff-candidate-sha" className="text-xs text-gray-500 font-medium">
                Candidate:
              </label>
              {onCandidateShaChange ? (
                <input
                  id="handoff-candidate-sha"
                  data-testid="handoff-candidate-sha-input"
                  type="text"
                  value={candidateSha}
                  onChange={(e) => onCandidateShaChange(e.target.value)}
                  placeholder="commit SHA..."
                  className="text-xs font-mono font-medium border border-gray-300 rounded-lg px-2.5 py-1.5 bg-white text-gray-900 shadow-xs focus:ring-2 focus:ring-indigo-500 focus:outline-hidden w-36"
                />
              ) : (
                <span
                  data-testid="handoff-candidate-sha"
                  className="text-xs font-mono font-medium text-gray-700 bg-gray-100 px-2 py-1 rounded"
                >
                  {candidateSha || 'none'}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Readiness Status Badge & Actions */}
        <div className="flex items-center gap-3 flex-wrap">
          {summary && (
            <div
              data-testid="handoff-status-badge"
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider border flex items-center gap-2 shadow-xs ${
                isReady
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                  : 'bg-amber-50 text-amber-900 border-amber-300'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isReady ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                }`}
              />
              <span>{isReady ? 'HANDOFF READY' : 'NOT READY FOR HANDOFF'}</span>
            </div>
          )}

          <div
            data-testid="handoff-promotion-badge"
            className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider border flex items-center gap-2 shadow-xs ${
              promotionStatus?.isApproved
                ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                : 'bg-amber-50 text-amber-900 border-amber-300'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                promotionStatus?.isApproved ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
              }`}
            />
            <span>
              {promotionStatus?.isApproved
                ? 'PROMOTION: APPROVED'
                : `PROMOTION: UNAPPROVED${promotionStatus?.diagnosticCode ? ` (${promotionStatus.diagnosticCode})` : ''}`}
            </span>
          </div>

          <button
            type="button"
            data-testid="export-handoff-json-btn"
            onClick={handleCopyJson}
            disabled={!bundle}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-xs transition disabled:opacity-50 flex items-center gap-1.5"
            title="Copy full JSON bundle to clipboard"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
              />
            </svg>
            <span>{copied ? 'Copied Bundle!' : 'Copy JSON'}</span>
          </button>

          <Link
            href={`/review${activeBaselineId ? `?baselineId=${encodeURIComponent(activeBaselineId)}` : ''}`}
            data-testid="back-to-review-link"
            className="px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 shadow-xs transition flex items-center gap-1"
          >
            <span>Reconciliation Workspace</span>
            <span>→</span>
          </Link>

          <button
            type="button"
            data-testid="handoff-refresh-btn"
            onClick={onRefresh}
            className="p-1.5 text-gray-500 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50 shadow-xs transition"
            title="Refresh handoff data"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

      {/* Metric Pills Bar */}
      {summary && (
        <div
          data-testid="handoff-metric-pills"
          className="mt-4 pt-3 border-t border-gray-100 flex items-center gap-2 flex-wrap text-xs"
        >
          <div
            data-testid="metric-stories"
            className="px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-md font-medium text-gray-700 flex items-center gap-1.5"
          >
            <span className="text-gray-500">Stories:</span>
            <span
              className={
                summary.readyStories === summary.totalStories && summary.totalStories > 0
                  ? 'text-emerald-700 font-bold'
                  : 'text-amber-700 font-bold'
              }
            >
              {summary.readyStories} / {summary.totalStories} Ready
            </span>
          </div>

          <div
            data-testid="metric-requirements"
            className="px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-md font-medium text-gray-700 flex items-center gap-1.5"
          >
            <span className="text-gray-500">Requirements:</span>
            <span
              className={
                summary.coveredRequirements === summary.totalRequirements &&
                summary.totalRequirements > 0
                  ? 'text-emerald-700 font-bold'
                  : 'text-amber-700 font-bold'
              }
            >
              {summary.coveredRequirements} / {summary.totalRequirements} Covered (
              {summary.totalRequirements > 0
                ? Math.round((summary.coveredRequirements / summary.totalRequirements) * 100)
                : 100}
              % Coverage)
            </span>
          </div>

          <div
            data-testid="metric-blockers"
            className="px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-md font-medium text-gray-700 flex items-center gap-1.5"
          >
            <span className="text-gray-500">Blockers:</span>
            <span
              className={
                summary.openBlockingFindings === 0
                  ? 'text-emerald-700 font-bold'
                  : 'text-red-700 font-bold'
              }
            >
              {summary.openBlockingFindings} Open Blockers
            </span>
          </div>

          <div
            data-testid="metric-cycles"
            className="px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-md font-medium text-gray-700 flex items-center gap-1.5"
          >
            <span className="text-gray-500">Graph:</span>
            <span className={hasCycles ? 'text-red-700 font-bold' : 'text-emerald-700 font-bold'}>
              {hasCycles ? '⚠ Cycle Detected' : '✔ Acyclic (DAG)'}
            </span>
          </div>

          {stalenessReport && (
            <div
              data-testid="metric-staleness"
              className="px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-md font-medium text-gray-700 flex items-center gap-1.5"
            >
              <span className="text-gray-500">Staleness:</span>
              <span
                className={
                  stalenessReport.staleCount === 0 && stalenessReport.impactedCount === 0
                    ? 'text-emerald-700 font-bold'
                    : 'text-amber-700 font-bold'
                }
              >
                {stalenessReport.currentCount} Current
                {stalenessReport.staleCount > 0 ? ` / ${stalenessReport.staleCount} Stale` : ''}
                {stalenessReport.impactedCount > 0
                  ? ` / ${stalenessReport.impactedCount} Impacted`
                  : ''}
                {stalenessReport.unexportedCount > 0
                  ? ` / ${stalenessReport.unexportedCount} Unexported`
                  : ''}
              </span>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
