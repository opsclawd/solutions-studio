'use client';

import React, { useState, useEffect } from 'react';
import type { RequirementCategoryDto, RequirementOriginDto } from '@solutions-studio/contracts';
import type { FindingDisposition } from '@solutions-studio/domain';

import { useReviewState } from '../state/useReviewState';
import {
  acceptRequirement,
  rejectRequirement,
  reviseRequirement,
  resolveRequirement,
  dispositionFinding,
  reopenFinding
} from '../api/mutations';
import { ActorIdentity, ACTOR_STORAGE_KEY } from './ActorIdentity';
import { ErrorBanner } from './ErrorBanner';
import { RequirementList } from './RequirementList';
import { RequirementDetail } from './RequirementDetail';
import { AllFindingsPanel } from './AllFindingsPanel';
import { ProjectionsPanel } from './ProjectionsPanel';

export interface ReviewWorkspaceProps {
  baselineId?: string;
}

export function ReviewWorkspace({ baselineId }: ReviewWorkspaceProps) {
  const [actorId, setActorId] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(ACTOR_STORAGE_KEY);
      if (stored) setActorId(stored);
    }
  }, []);

  const {
    status,
    data,
    error,
    mutationError,
    selectedRequirementId,
    selectedRequirement,
    selectedProjectionId,
    projections,
    findingsView,
    findingsForSelectedRequirement,
    revisionRequirementIndex,
    evidenceByKey,
    historyByEntityId,
    refresh,
    selectRequirement,
    selectProjection,
    setFindingsView,
    clearMutationError,
    handleRequirementMutation,
    handleFindingMutation,
    handleGenerateProjection
  } = useReviewState(baselineId);

  // Handlers for requirements
  const handleAccept = async (rationale: string) => {
    if (!selectedRequirement) return;
    await handleRequirementMutation(() =>
      acceptRequirement(selectedRequirement.id, {
        rationale,
        actorId: actorId || undefined
      })
    );
  };

  const handleReject = async (rationale: string) => {
    if (!selectedRequirement) return;
    await handleRequirementMutation(() =>
      rejectRequirement(selectedRequirement.id, {
        rationale,
        actorId: actorId || undefined
      })
    );
  };

  const handleResolve = async (rationale: string) => {
    if (!selectedRequirement) return;
    await handleRequirementMutation(() =>
      resolveRequirement(selectedRequirement.id, {
        rationale,
        actorId: actorId || undefined
      })
    );
  };

  const handleRevise = async (changes: {
    statement?: string;
    category?: RequirementCategoryDto;
    origin?: RequirementOriginDto;
    rationale: string;
    affectedActors?: string[];
    dependencies?: string[];
  }) => {
    if (!selectedRequirement) return;
    await handleRequirementMutation(() =>
      reviseRequirement(selectedRequirement.id, {
        ...changes,
        actorId: actorId || undefined
      })
    );
  };

  // Handlers for findings
  const handleFindingDisposition = async (
    findingId: string,
    disposition: FindingDisposition,
    rationale: string
  ) => {
    await handleFindingMutation(() =>
      dispositionFinding(findingId, {
        disposition,
        rationale,
        actorId: actorId || undefined
      })
    );
  };

  const handleFindingReopen = async (findingId: string, rationale?: string) => {
    await handleFindingMutation(() =>
      reopenFinding(findingId, {
        rationale,
        actorId: actorId || undefined
      })
    );
  };

  const historyForSelectedReq = selectedRequirement
    ? (historyByEntityId.get(selectedRequirement.requirementId) ?? [])
    : [];

  return (
    <div data-testid="review-workspace" className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header Bar */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-black text-sm shadow-xs">
              SS
            </div>
            <div>
              <h1
                data-testid="workspace-title"
                className="text-base font-bold text-gray-900 leading-tight"
              >
                Requirements Review &amp; Reconciliation
              </h1>
              <p className="text-xs text-gray-500">
                Phase 2.2 — Solutions Studio Reviewer Workspace
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* View Switcher */}
            <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200 text-xs">
              <button
                type="button"
                data-testid="view-by-requirement-btn"
                onClick={() => setFindingsView('byRequirement')}
                className={`px-3 py-1 rounded-md font-medium transition ${
                  findingsView === 'byRequirement'
                    ? 'bg-white text-gray-900 shadow-xs'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Requirements ({data?.requirementRevisions.length ?? 0})
              </button>
              <button
                type="button"
                data-testid="view-all-findings-btn"
                onClick={() => setFindingsView('all')}
                className={`px-3 py-1 rounded-md font-medium transition ${
                  findingsView === 'all'
                    ? 'bg-white text-gray-900 shadow-xs'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                All Findings ({data?.findings.length ?? 0})
              </button>
              <button
                type="button"
                data-testid="view-projections-btn"
                onClick={() => setFindingsView('projections')}
                className={`px-3 py-1 rounded-md font-medium transition ${
                  findingsView === 'projections'
                    ? 'bg-white text-gray-900 shadow-xs'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Diagram Projections ({projections.length})
              </button>
            </div>

            <button
              type="button"
              data-testid="refresh-btn"
              onClick={refresh}
              className="p-1.5 text-gray-500 hover:text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
              title="Refresh State"
            >
              ↻
            </button>

            <ActorIdentity actorId={actorId} onActorChange={setActorId} />
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {/* Error Banners */}
        {error && <ErrorBanner error={error} onReload={refresh} />}

        {mutationError && (
          <ErrorBanner
            error={mutationError}
            onDismiss={clearMutationError}
            onReload={async () => {
              clearMutationError();
              await refresh();
            }}
          />
        )}

        {status === 'loading' && !data ? (
          <div data-testid="review-loading" className="p-12 text-center text-gray-500 font-medium">
            Loading requirements review state...
          </div>
        ) : findingsView === 'projections' ? (
          <ProjectionsPanel
            baselineId={data?.baseline?.id ?? baselineId}
            projections={projections}
            selectedProjectionId={selectedProjectionId}
            actorId={actorId}
            onSelectProjection={selectProjection}
            onGenerateProjection={handleGenerateProjection}
            onRefreshWorkspace={refresh}
          />
        ) : findingsView === 'all' ? (
          <AllFindingsPanel
            allFindings={data?.findings ?? []}
            lineageIndex={revisionRequirementIndex}
            actorId={actorId}
            onDisposition={handleFindingDisposition}
            onReopen={handleFindingReopen}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Pane: Requirement List */}
            <div className="lg:col-span-4 sticky top-20">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Requirements List
                </span>
                <span data-testid="requirements-count" className="text-xs text-gray-400 font-mono">
                  {data?.requirementRevisions.length ?? 0} total
                </span>
              </div>
              <RequirementList
                revisions={data?.requirementRevisions ?? []}
                selectedRequirementId={selectedRequirementId}
                onSelect={selectRequirement}
              />
            </div>

            {/* Right Pane: Requirement Detail */}
            <div className="lg:col-span-8">
              {selectedRequirement ? (
                <RequirementDetail
                  revision={selectedRequirement}
                  baselineId={data?.baseline?.id ?? baselineId}
                  evidenceByKey={evidenceByKey}
                  findings={findingsForSelectedRequirement}
                  historyRecords={historyForSelectedReq}
                  actorId={actorId}
                  onAccept={handleAccept}
                  onReject={handleReject}
                  onResolve={handleResolve}
                  onRevise={handleRevise}
                  onFindingDisposition={handleFindingDisposition}
                  onFindingReopen={handleFindingReopen}
                />
              ) : (
                <div
                  data-testid="no-requirement-selected"
                  className="bg-white border border-gray-200 rounded-xl p-12 text-center text-gray-500"
                >
                  Select a requirement from the list to inspect details and perform reconciliation.
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
