'use client';

import React from 'react';
import type {
  RequirementRevisionDto,
  CandidateFindingDto,
  EvidenceExcerptDto,
  ReconciliationRecordDto,
  RequirementCategoryDto,
  RequirementOriginDto
} from '@solutions-studio/contracts';
import type { FindingDisposition } from '@solutions-studio/domain';

import { getOriginBadge, getReviewStateBadge, getResolutionStateBadge } from './badges';
import { ActionForms } from './ActionForms';
import { EvidencePanel } from './EvidencePanel';
import { FindingsPanel } from './FindingsPanel';
import { ReconciliationHistory } from './ReconciliationHistory';

export interface RequirementDetailProps {
  revision: RequirementRevisionDto;
  baselineId?: string;
  evidenceByKey: ReadonlyMap<string, EvidenceExcerptDto>;
  findings: readonly CandidateFindingDto[];
  historyRecords: readonly ReconciliationRecordDto[];
  actorId?: string;
  onAccept: (rationale: string) => Promise<void>;
  onReject: (rationale: string) => Promise<void>;
  onResolve: (rationale: string) => Promise<void>;
  onRevise: (changes: {
    statement?: string;
    category?: RequirementCategoryDto;
    origin?: RequirementOriginDto;
    rationale: string;
    affectedActors?: string[];
    dependencies?: string[];
  }) => Promise<void>;
  onFindingDisposition: (
    findingId: string,
    disposition: FindingDisposition,
    rationale: string
  ) => Promise<void>;

  onFindingReopen: (findingId: string, rationale?: string) => Promise<void>;
}

export function RequirementDetail({
  revision,
  baselineId,
  evidenceByKey,
  findings,
  historyRecords,
  actorId,
  onAccept,
  onReject,
  onResolve,
  onRevise,
  onFindingDisposition,
  onFindingReopen
}: RequirementDetailProps) {
  const originBadge = getOriginBadge(revision.origin);
  const reviewBadge = getReviewStateBadge(revision.reviewState);
  const resolutionBadge = getResolutionStateBadge(revision.resolutionState);

  return (
    <div data-testid="requirement-detail" className="space-y-6">
      {/* Header Card */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2
                data-testid="detail-requirement-id"
                className="text-xl font-black font-mono text-gray-900 tracking-tight"
              >
                {revision.requirementId}
              </h2>
              <span
                data-testid="detail-revision-id"
                className="bg-blue-50 text-blue-800 border border-blue-200 text-xs font-mono font-bold px-2 py-0.5 rounded"
              >
                Revision {revision.revision} ({revision.id})
              </span>
              {revision.supersedes && (
                <span data-testid="detail-supersedes" className="text-xs text-gray-400 font-mono">
                  supersedes {revision.supersedes}
                </span>
              )}
            </div>

            <div
              data-testid="detail-baseline-context"
              className="text-xs text-gray-500 flex items-center gap-1"
            >
              <span>Scope:</span>
              <span className="font-medium text-gray-700">
                {baselineId
                  ? `Baseline ${baselineId}`
                  : 'Current working state (unbaselined reviewer inbox)'}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              data-testid="detail-origin-badge"
              className={`px-2.5 py-1 rounded border text-xs font-semibold ${originBadge.className}`}
            >
              {originBadge.label}
            </span>
            <span
              data-testid="detail-review-badge"
              className={`px-2.5 py-1 rounded border text-xs font-semibold ${reviewBadge.className}`}
            >
              {reviewBadge.label}
            </span>
            <span
              data-testid="detail-resolution-badge"
              className={`px-2.5 py-1 rounded border text-xs font-semibold ${resolutionBadge.className}`}
            >
              {resolutionBadge.label}
            </span>
          </div>
        </div>

        {/* Statement Box */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
            Requirement Statement
          </label>
          <p
            data-testid="detail-statement"
            className="text-base text-gray-900 font-medium leading-relaxed bg-gray-50/70 p-4 rounded-lg border border-gray-100"
          >
            {revision.statement}
          </p>
        </div>

        {/* Metadata Grid */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
            <span className="font-semibold text-gray-500 block mb-1">Category</span>
            <span data-testid="detail-category" className="font-mono text-gray-800">
              {revision.category}
            </span>
          </div>

          <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
            <span className="font-semibold text-gray-500 block mb-1">Affected Actors</span>
            <span data-testid="detail-actors" className="text-gray-800">
              {revision.affectedActors && revision.affectedActors.length > 0
                ? revision.affectedActors.join(', ')
                : 'None specified'}
            </span>
          </div>

          <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
            <span className="font-semibold text-gray-500 block mb-1">Dependencies</span>
            <span data-testid="detail-dependencies" className="font-mono text-gray-800">
              {revision.dependencies && revision.dependencies.length > 0
                ? revision.dependencies.join(', ')
                : 'None'}
            </span>
          </div>
        </div>

        {/* Actions section */}
        <div className="mt-6 pt-5 border-t border-gray-200">
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2.5">
            Reconciliation Actions
          </label>
          <ActionForms
            revision={revision}
            actorId={actorId}
            onAccept={onAccept}
            onReject={onReject}
            onResolve={onResolve}
            onRevise={onRevise}
          />
        </div>
      </div>

      {/* Detail Panels (Evidence, Findings, History) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Supporting Evidence Panel */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-100">
            <h3 className="font-bold text-sm text-gray-900">
              Supporting Evidence ({revision.evidence.length})
            </h3>
            <span className="text-[11px] text-gray-400">Provenance & Locators</span>
          </div>
          <EvidencePanel evidence={revision.evidence} evidenceByKey={evidenceByKey} />
        </div>

        {/* Open Findings Panel */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-100">
            <h3 className="font-bold text-sm text-gray-900">
              Findings for Requirement ({findings.length})
            </h3>
            <span className="text-[11px] text-gray-400">Model & Human Audits</span>
          </div>
          <FindingsPanel
            requirementId={revision.requirementId}
            findings={findings}
            actorId={actorId}
            onDisposition={onFindingDisposition}
            onReopen={onFindingReopen}
          />
        </div>
      </div>

      {/* Reconciliation History Section */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs">
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-100">
          <h3 className="font-bold text-sm text-gray-900">
            Reconciliation Audit History ({historyRecords.length})
          </h3>
          <span className="text-[11px] text-gray-400">Successor Revisions & Rationale</span>
        </div>
        <ReconciliationHistory records={historyRecords} />
      </div>
    </div>
  );
}
