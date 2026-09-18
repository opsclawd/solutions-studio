'use client';

import React from 'react';
import type { CandidateFindingDto } from '@solutions-studio/contracts';
import type { FindingDisposition } from '@solutions-studio/domain';
import type { RevisionRequirementIndex } from '../lineage/revisionRequirementIndex';
import { FindingItem } from './FindingItem';

export interface AllFindingsPanelProps {
  allFindings: readonly CandidateFindingDto[];
  lineageIndex: RevisionRequirementIndex;
  actorId?: string;
  onDisposition: (
    findingId: string,
    disposition: FindingDisposition,
    rationale: string
  ) => Promise<void>;
  onReopen: (findingId: string, rationale?: string) => Promise<void>;
}

export function AllFindingsPanel({
  allFindings,
  lineageIndex,
  actorId,
  onDisposition,
  onReopen
}: AllFindingsPanelProps) {
  if (allFindings.length === 0) {
    return (
      <div
        data-testid="all-findings-empty"
        className="p-8 text-center text-gray-500 bg-white border border-gray-200 rounded-xl"
      >
        No findings recorded in this review workspace.
      </div>
    );
  }

  // Group findings: attached by requirementId vs unattached
  const unattached = lineageIndex.unresolvedFindings;
  const attachedEntries = Array.from(lineageIndex.findingsByRequirementId.entries());

  return (
    <div data-testid="all-findings-panel" className="space-y-6">
      <div className="flex items-center justify-between pb-3 border-b border-gray-200">
        <div>
          <h2 className="text-lg font-bold text-gray-900">All Workspace Findings</h2>
          <p className="text-xs text-gray-500">
            Repository-wide findings, including requirements-linked issues and unattached
            discoveries.
          </p>
        </div>
        <span
          data-testid="all-findings-count"
          className="bg-gray-100 text-gray-800 text-xs font-semibold px-2.5 py-1 rounded"
        >
          {allFindings.length} Total Finding{allFindings.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Unattached Findings Section */}
      {unattached.length > 0 && (
        <div
          data-testid="unattached-findings-group"
          className="bg-amber-50/50 border border-amber-200 rounded-xl p-4"
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="px-2 py-0.5 rounded bg-amber-200 text-amber-900 text-xs font-bold">
              UNATTACHED
            </span>
            <h3 className="text-sm font-bold text-amber-900">
              Repository-Wide / Unattached Findings ({unattached.length})
            </h3>
          </div>
          <p className="text-xs text-amber-800/80 mb-3">
            These findings are not linked to a specific requirement revision in the current scope.
          </p>
          <div className="space-y-3">
            {unattached.map((finding) => (
              <FindingItem
                key={finding.id}
                finding={finding}
                actorId={actorId}
                onDisposition={onDisposition}
                onReopen={onReopen}
              />
            ))}
          </div>
        </div>
      )}

      {/* Grouped by Requirement */}
      {attachedEntries.map(([reqId, findings]) => (
        <div
          key={reqId}
          data-testid={`req-findings-group-${reqId}`}
          className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs"
        >
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-500">Requirement:</span>
              <span className="font-mono font-bold text-sm text-blue-700">{reqId}</span>
            </div>
            <span className="text-xs text-gray-500">
              {findings.length} Finding{findings.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="space-y-3">
            {findings.map((finding) => (
              <FindingItem
                key={finding.id}
                finding={finding}
                actorId={actorId}
                onDisposition={onDisposition}
                onReopen={onReopen}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
