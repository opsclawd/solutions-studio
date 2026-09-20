'use client';

import React from 'react';
import Link from 'next/link';
import type {
  CandidateFindingDto,
  RequirementRevisionDto,
  StoryDependencyGraphDto,
  EngineeringDecisionDto
} from '@solutions-studio/contracts';

export interface UnresolvedFindingsAlertProps {
  readonly baselineId: string;
  readonly blockingFindings: readonly CandidateFindingDto[];
  readonly unresolvedRequirements: readonly RequirementRevisionDto[];
  readonly dependencyGraph?: StoryDependencyGraphDto;
  readonly engineeringDecisions?: readonly EngineeringDecisionDto[];
}

export function UnresolvedFindingsAlert({
  baselineId,
  blockingFindings,
  unresolvedRequirements,
  dependencyGraph,
  engineeringDecisions = []
}: UnresolvedFindingsAlertProps) {
  const hasBlockers = blockingFindings.length > 0;
  const hasUnresolvedReqs = unresolvedRequirements.length > 0;
  const hasCycles = dependencyGraph?.hasCycles ?? false;
  const proposedDecisions = engineeringDecisions.filter((d) => d.state === 'PROPOSED');
  const hasProposedDecisions = proposedDecisions.length > 0;

  if (!hasBlockers && !hasUnresolvedReqs && !hasCycles && !hasProposedDecisions) {
    return null;
  }

  const totalBlockerCount =
    blockingFindings.length +
    unresolvedRequirements.length +
    (hasCycles ? 1 : 0) +
    proposedDecisions.length;

  return (
    <div
      data-testid="unresolved-findings-alert"
      className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg shadow-xs my-4 space-y-3"
    >
      <div className="flex items-start gap-3">
        <div className="text-red-600 mt-0.5">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>

        <div className="flex-1">
          <h2 className="text-sm font-bold text-red-900 tracking-tight">
            Handoff Blockers Detected ({totalBlockerCount})
          </h2>
          <p className="text-xs text-red-700 mt-0.5">
            Engineering handoff is blocked until all candidate findings are reconciled, requirements
            are accepted, proposed decisions are reviewed, and dependency cycles are eliminated.
          </p>
        </div>
      </div>

      {/* Dependency Cycles */}
      {hasCycles && (
        <div className="bg-white/80 border border-red-200 rounded-md p-3 text-xs">
          <div className="flex items-center gap-2 font-semibold text-red-800">
            <span>Cycle Detected in Story Dependencies:</span>
            <span className="font-mono bg-red-100 px-1.5 py-0.5 rounded text-red-900">
              {dependencyGraph?.cycles.map((c) => c.join(' ➔ ')).join(' | ')}
            </span>
          </div>
          <p className="text-red-700 mt-1">
            Topological execution order cannot be computed while a circular dependency exists.
            Remove or break the cycle in the backlog section below.
          </p>
        </div>
      )}

      {/* Blocking Findings */}
      {hasBlockers && (
        <div className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-red-800">
            Open Candidate Findings ({blockingFindings.length})
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {blockingFindings.map((finding) => {
              const primaryReqId = finding.affectedRequirementRevisions[0] ?? '';
              const reviewLink = `/review?baselineId=${encodeURIComponent(baselineId)}${
                primaryReqId ? `&requirementId=${encodeURIComponent(primaryReqId)}` : ''
              }`;

              return (
                <div
                  key={finding.id}
                  className="bg-white border border-red-200 rounded-md p-2.5 text-xs flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="font-mono font-bold text-red-900">{finding.id}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold bg-red-100 text-red-800">
                        {finding.type}
                      </span>
                    </div>
                    <p className="text-gray-700 line-clamp-2">
                      {finding.rationale ?? 'No rationale recorded'}
                    </p>
                  </div>
                  <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between">
                    <span className="text-[11px] text-gray-500 font-mono">
                      Affects: {finding.affectedRequirementRevisions.join(', ') || 'N/A'}
                    </span>
                    <Link
                      href={reviewLink}
                      data-testid="unresolved-finding-link"
                      className="text-indigo-600 hover:text-indigo-800 font-medium text-[11px] flex items-center gap-0.5"
                    >
                      <span>Reconcile</span>
                      <span>→</span>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Unresolved Requirements */}
      {hasUnresolvedReqs && (
        <div className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-red-800">
            Unresolved Requirements ({unresolvedRequirements.length})
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {unresolvedRequirements.map((req) => {
              const reviewLink = `/review?baselineId=${encodeURIComponent(baselineId)}&requirementId=${encodeURIComponent(req.id)}`;

              return (
                <div
                  key={req.id}
                  className="bg-white border border-red-200 rounded-md p-2.5 text-xs flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="font-mono font-bold text-gray-900">{req.id}</span>
                      <div className="flex items-center gap-1">
                        <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold bg-amber-100 text-amber-800">
                          {req.reviewState}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold bg-gray-100 text-gray-700">
                          {req.resolutionState}
                        </span>
                      </div>
                    </div>
                    <p className="text-gray-700 line-clamp-2">{req.statement}</p>
                  </div>
                  <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-end">
                    <Link
                      href={reviewLink}
                      data-testid="unresolved-req-link"
                      className="text-indigo-600 hover:text-indigo-800 font-medium text-[11px] flex items-center gap-0.5"
                    >
                      <span>Review in Reconciliation</span>
                      <span>→</span>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Proposed Engineering Decisions */}
      {hasProposedDecisions && (
        <div className="space-y-1.5" data-testid="proposed-decisions-alert-section">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-800">
            Proposed Engineering Decisions ({proposedDecisions.length})
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {proposedDecisions.map((dec) => {
              const primaryReqId = dec.requirementRevisionIds[0] ?? '';
              const reviewLink = `/review?baselineId=${encodeURIComponent(baselineId)}${
                primaryReqId ? `&requirementId=${encodeURIComponent(primaryReqId)}` : ''
              }`;

              return (
                <div
                  key={dec.id}
                  data-testid={`proposed-decision-item-${dec.id}`}
                  className="bg-white border border-amber-200 rounded-md p-2.5 text-xs flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="font-mono font-bold text-amber-900">{dec.id}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold bg-amber-100 text-amber-800">
                        {dec.state}
                      </span>
                    </div>
                    <p className="text-gray-800 font-medium">{dec.statement}</p>
                    {dec.rationale && (
                      <p className="text-gray-600 mt-1 line-clamp-2">{dec.rationale}</p>
                    )}
                  </div>
                  <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between">
                    <span className="text-[11px] text-gray-500 font-mono">
                      Affects: {dec.requirementRevisionIds.join(', ') || 'General'}
                    </span>
                    <Link
                      href={reviewLink}
                      data-testid="unresolved-finding-link"
                      className="text-indigo-600 hover:text-indigo-800 font-medium text-[11px] flex items-center gap-0.5"
                    >
                      <span>Review</span>
                      <span>→</span>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
