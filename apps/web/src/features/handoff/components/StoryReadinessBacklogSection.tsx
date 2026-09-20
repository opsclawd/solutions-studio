'use client';

import React, { useState } from 'react';
import type {
  StoryDto,
  StoryReadinessReportDto,
  BaselineRequirementCoverageDto,
  BaselineExportStalenessReportDto,
  StoryExportStalenessReportDto,
  ExportBacklogRequestDto,
  ExportBacklogResponseDto
} from '@solutions-studio/contracts';

export interface StoryReadinessBacklogSectionProps {
  readonly stories: readonly StoryDto[];
  readonly readinessReports: readonly StoryReadinessReportDto[];
  readonly coverage: BaselineRequirementCoverageDto;
  readonly stalenessReport?: BaselineExportStalenessReportDto | null;
  readonly onUpdateDependencies: (storyId: string, dependencies: string[]) => Promise<void>;
  readonly onExportBacklog?: (
    request: ExportBacklogRequestDto
  ) => Promise<ExportBacklogResponseDto>;
  readonly isUpdatingDependencies?: boolean;
  readonly mutationError?: string | null;
}

export function StoryReadinessBacklogSection({
  stories,
  readinessReports,
  coverage,
  stalenessReport,
  onUpdateDependencies,
  onExportBacklog,
  isUpdatingDependencies = false,
  mutationError = null
}: StoryReadinessBacklogSectionProps) {
  const [editingStoryId, setEditingStoryId] = useState<string | null>(null);
  const [editedDependencies, setEditedDependencies] = useState<string[]>([]);
  const [expandedStoryId, setExpandedStoryId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  // Export modal state
  const [exportModalStoryId, setExportModalStoryId] = useState<string | null>(null);
  const [exportTargetContainer, setExportTargetContainer] = useState<string>('acme/repo');
  const [exportRationale, setExportRationale] = useState<string>('');
  const [allowUpdateExisting, setAllowUpdateExisting] = useState<boolean>(true);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportFeedback, setExportFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const reportMap = new Map<string, StoryReadinessReportDto>();
  for (const r of readinessReports) {
    reportMap.set(r.storyId, r);
  }

  const stalenessMap = new Map<string, StoryExportStalenessReportDto>();
  if (stalenessReport?.stories) {
    for (const s of stalenessReport.stories) {
      stalenessMap.set(s.storyId, s);
    }
  }

  const handleStartEditDependencies = (story: StoryDto) => {
    setEditingStoryId(story.id);
    setEditedDependencies(story.dependencies ? [...story.dependencies] : []);
    setLocalError(null);
  };

  const handleToggleDependency = (depId: string) => {
    setEditedDependencies((prev) =>
      prev.includes(depId) ? prev.filter((d) => d !== depId) : [...prev, depId]
    );
  };

  const handleSaveDependencies = async (storyId: string) => {
    setLocalError(null);
    try {
      await onUpdateDependencies(storyId, editedDependencies);
      setEditingStoryId(null);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to update dependencies');
    }
  };

  const handleCancelEdit = () => {
    setEditingStoryId(null);
    setLocalError(null);
  };

  return (
    <div
      data-testid="story-readiness-backlog-section"
      className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden"
    >
      {/* Header & Coverage Summary Bar */}
      <div className="border-b border-gray-200 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-gray-900 tracking-tight flex items-center gap-2 flex-wrap">
              <span>Story Readiness & Backlog</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">
                {stories.length} Stories
              </span>
              {stalenessReport && (
                <span
                  data-testid="staleness-summary-badge"
                  className={`text-xs px-2.5 py-0.5 rounded-full font-medium border ${
                    stalenessReport.staleCount === 0 && stalenessReport.impactedCount === 0
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}
                >
                  {stalenessReport.currentCount} Current · {stalenessReport.staleCount} Stale ·{' '}
                  {stalenessReport.impactedCount} Impacted
                </span>
              )}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Definitive readiness audits (Rules 1-10) and prerequisite dependency alignment
            </p>
          </div>

          {/* Coverage Summary Pill Box */}
          <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs">
            <div>
              <span className="text-gray-500 block">Coverage</span>
              <span
                className={`font-bold ${
                  coverage.isFullyCovered ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {coverage.totalRequirements > 0
                  ? Math.round((coverage.coveredCount / coverage.totalRequirements) * 100)
                  : 100}
                %
              </span>
            </div>
            <div className="border-l border-gray-200 pl-3">
              <span className="text-gray-500 block">Covered</span>
              <span className="font-bold text-gray-800">
                {coverage.coveredCount}/{coverage.totalRequirements} Reqs
              </span>
            </div>
            {coverage.uncoveredCount > 0 && (
              <div className="border-l border-gray-200 pl-3">
                <span className="text-gray-500 block">Uncovered</span>
                <span className="font-bold text-red-700">{coverage.uncoveredCount}</span>
              </div>
            )}
          </div>
        </div>

        {/* Mutation Error alert */}
        {(mutationError || localError) && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex items-center justify-between">
            <span>{localError ?? mutationError}</span>
            <button
              type="button"
              onClick={() => setLocalError(null)}
              className="text-red-500 hover:text-red-700 font-bold ml-2"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Story Cards List */}
      <div className="divide-y divide-gray-100">
        {stories.length === 0 ? (
          <div className="p-8 text-center text-xs text-gray-500">
            No stories generated for this baseline yet.
          </div>
        ) : (
          stories.map((story) => {
            const report = reportMap.get(story.id);
            const staleness = stalenessMap.get(story.id);
            const isReady = report?.isReady ?? false;
            const isEditingDeps = editingStoryId === story.id;
            const isExpanded = expandedStoryId === story.id;

            return (
              <div
                key={story.id}
                data-testid={`story-card-${story.id}`}
                className="p-6 bg-white hover:bg-gray-50/40 transition"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  {/* Left Column: ID, Title, Narrative */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-mono text-xs font-bold text-gray-900 bg-gray-100 px-2 py-0.5 rounded">
                        {story.id}
                      </span>
                      <h3 className="text-sm font-bold text-gray-900 truncate">{story.title}</h3>
                      <div
                        data-testid="story-readiness-badge"
                        className={`px-2 py-0.5 rounded-full text-[11px] font-semibold flex items-center gap-1 ${
                          isReady
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-900'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            isReady ? 'bg-emerald-500' : 'bg-amber-500'
                          }`}
                        />
                        <span>{isReady ? 'Ready' : 'Not Ready'}</span>
                      </div>

                      {staleness && (
                        <div
                          data-testid={`story-staleness-badge-${story.id}`}
                          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold flex items-center gap-1 ${
                            staleness.classification === 'CURRENT'
                              ? 'bg-emerald-100 text-emerald-800'
                              : staleness.classification === 'STALE'
                                ? 'bg-red-100 text-red-800'
                                : staleness.classification === 'IMPACTED'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              staleness.classification === 'CURRENT'
                                ? 'bg-emerald-500'
                                : staleness.classification === 'STALE'
                                  ? 'bg-red-500'
                                  : staleness.classification === 'IMPACTED'
                                    ? 'bg-amber-500'
                                    : 'bg-gray-400'
                            }`}
                          />
                          <span>
                            {staleness.classification === 'UNEXPORTED'
                              ? 'Not Exported'
                              : staleness.classification}
                          </span>
                        </div>
                      )}

                      {staleness?.advisorySemanticImpact && (
                        <div
                          data-testid={`story-semantic-impact-badge-${story.id}`}
                          title={`${staleness.advisorySemanticImpact.reasoning}${
                            staleness.advisorySemanticImpact.suggestedActions.length > 0
                              ? ` | Actions: ${staleness.advisorySemanticImpact.suggestedActions.join('; ')}`
                              : ''
                          }`}
                          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold flex items-center gap-1 cursor-help ${
                            staleness.advisorySemanticImpact.semanticRiskLevel === 'HIGH'
                              ? 'bg-purple-100 text-purple-900 border border-purple-200'
                              : staleness.advisorySemanticImpact.semanticRiskLevel === 'MEDIUM'
                                ? 'bg-indigo-100 text-indigo-900 border border-indigo-200'
                                : 'bg-blue-100 text-blue-800 border border-blue-200'
                          }`}
                        >
                          <span>⚡</span>
                          <span>
                            Advisory: {staleness.advisorySemanticImpact.semanticRiskLevel}
                          </span>
                        </div>
                      )}
                    </div>

                    <p className="text-xs text-gray-600 mt-2 font-medium">
                      As a <span className="text-gray-900">{story.narrative.role}</span>, I want to{' '}
                      <span className="text-gray-900">{story.narrative.feature}</span> so that{' '}
                      <span className="text-gray-900">{story.narrative.benefit}</span>.
                    </p>

                    <div className="mt-2.5 flex items-center gap-3 text-[11px] text-gray-500 flex-wrap">
                      <span>
                        Requirements:{' '}
                        <span className="font-mono text-gray-700">
                          {story.requirementRevisionIds.join(', ')}
                        </span>
                      </span>
                      <span>•</span>
                      <span>Scenarios: {story.scenarios.length}</span>
                      <span>•</span>
                      <span>ACs: {story.acceptanceCriteria.length}</span>
                    </div>

                    {staleness && (
                      <div
                        data-testid={`story-lineage-${story.id}`}
                        className="mt-2 text-[11px] text-gray-500 flex items-center gap-2 flex-wrap font-mono"
                      >
                        <span>
                          Story: v{story.version ?? staleness.exportedLineage?.storyVersion ?? 1}
                        </span>
                        <span>•</span>
                        <span>
                          Export:{' '}
                          {staleness.exportedLineage
                            ? `v${staleness.exportedLineage.exportVersion}`
                            : 'None'}
                        </span>
                        <span>•</span>
                        <span title={staleness.currentContentHash}>
                          Hash: {staleness.currentContentHash.slice(0, 8)}
                        </span>
                        {staleness.exportedLineage?.baselineId && (
                          <>
                            <span>•</span>
                            <span data-testid={`story-lineage-baseline-${story.id}`}>
                              Baseline: {staleness.exportedLineage.baselineId}
                            </span>
                          </>
                        )}
                        {staleness.exportedLineage?.exportedAt && (
                          <>
                            <span>•</span>
                            <span data-testid={`story-lineage-exported-at-${story.id}`}>
                              Exported:{' '}
                              {new Date(staleness.exportedLineage.exportedAt).toLocaleString()}
                            </span>
                          </>
                        )}
                        {staleness.exportedLineage?.externalUrl && (
                          <>
                            <span>•</span>
                            <a
                              href={staleness.exportedLineage.externalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-600 hover:underline inline-flex items-center gap-0.5 font-sans"
                            >
                              <span>Issue #{staleness.exportedLineage.externalWorkItemId}</span>
                              <span className="text-[10px]">↗</span>
                            </a>
                          </>
                        )}
                      </div>
                    )}

                    {staleness && staleness.causes && staleness.causes.length > 0 && (
                      <div
                        data-testid={`story-staleness-causes-${story.id}`}
                        className={`mt-2.5 p-2.5 rounded-lg text-xs border ${
                          staleness.classification === 'STALE'
                            ? 'bg-red-50/80 border-red-200 text-red-900'
                            : 'bg-amber-50/80 border-amber-200 text-amber-900'
                        }`}
                      >
                        <div className="font-semibold mb-1 flex items-center gap-1.5">
                          <span>Staleness Causes ({staleness.causes.length}):</span>
                        </div>
                        <ul className="space-y-1 list-disc list-inside">
                          {staleness.causes.map((c, idx) => (
                            <li key={idx} className="leading-normal">
                              <span className="font-mono font-bold">[{c.category}]</span>:{' '}
                              {c.message}
                            </li>
                          ))}
                        </ul>
                        {staleness.impactedByPrerequisiteStoryIds &&
                          staleness.impactedByPrerequisiteStoryIds.length > 0 && (
                            <div className="mt-1.5 pt-1.5 border-t border-amber-200/60 font-mono text-[11px] text-gray-700">
                              <span className="font-sans font-semibold text-gray-800">
                                Impacted By:{' '}
                              </span>
                              {staleness.impactedByPrerequisiteStoryIds.join(', ')}
                            </div>
                          )}
                      </div>
                    )}
                  </div>

                  {/* Right Column: Dependencies & Edit Button */}
                  <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs text-gray-500">Prerequisites:</span>
                      {!story.dependencies || story.dependencies.length === 0 ? (
                        <span className="text-xs text-gray-400 italic">None (Root)</span>
                      ) : (
                        story.dependencies.map((dep) => (
                          <span
                            key={dep}
                            className="font-mono text-xs px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded border border-indigo-200"
                          >
                            {dep}
                          </span>
                        ))
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-1">
                      {onExportBacklog && (
                        <button
                          type="button"
                          data-testid={`export-backlog-btn-${story.id}`}
                          onClick={() => {
                            setExportModalStoryId(story.id);
                            setExportRationale('');
                            setExportFeedback(null);
                          }}
                          className="text-xs font-medium text-emerald-700 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded border border-emerald-200 transition"
                        >
                          {staleness?.classification === 'STALE' ||
                          staleness?.classification === 'IMPACTED'
                            ? 'Update Export'
                            : 'Export Story'}
                        </button>
                      )}

                      <button
                        type="button"
                        data-testid={`edit-dependencies-btn-${story.id}`}
                        onClick={() =>
                          isEditingDeps ? handleCancelEdit() : handleStartEditDependencies(story)
                        }
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-800 bg-indigo-50/50 hover:bg-indigo-50 px-2.5 py-1 rounded border border-indigo-200 transition"
                      >
                        {isEditingDeps ? 'Cancel' : 'Edit Dependencies'}
                      </button>

                      <button
                        type="button"
                        data-testid={`toggle-details-btn-${story.id}`}
                        onClick={() => setExpandedStoryId(isExpanded ? null : story.id)}
                        className="text-xs text-gray-500 hover:text-gray-800 p-1"
                        title="Toggle Gherkin & Audit details"
                      >
                        {isExpanded ? '▲ Hide' : '▼ Details'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Inline Dependency Editor Modal / Panel */}
                {isEditingDeps && (
                  <div
                    data-testid={`story-dependency-editor-${story.id}`}
                    className="mt-4 p-4 bg-gray-50 border border-indigo-200 rounded-lg text-xs"
                  >
                    <div className="font-semibold text-gray-900 mb-2">
                      Select Prerequisite Dependencies for {story.id}:
                    </div>
                    <p className="text-gray-500 mb-3">
                      This story will only be scheduled after all selected prerequisites have
                      completed. Self-dependencies and circular chains will be rejected.
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-4">
                      {stories
                        .filter((s) => s.id !== story.id)
                        .map((candidate) => {
                          const isChecked = editedDependencies.includes(candidate.id);
                          return (
                            <label
                              key={candidate.id}
                              className={`flex items-center gap-2 p-2 rounded border cursor-pointer transition ${
                                isChecked
                                  ? 'bg-indigo-50 border-indigo-300 text-indigo-900'
                                  : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100'
                              }`}
                            >
                              <input
                                type="checkbox"
                                data-testid={`dep-checkbox-${candidate.id}`}
                                checked={isChecked}
                                onChange={() => handleToggleDependency(candidate.id)}
                                className="rounded text-indigo-600 focus:ring-indigo-500"
                              />
                              <span className="font-mono font-bold">{candidate.id}</span>
                              <span className="truncate">{candidate.title}</span>
                            </label>
                          );
                        })}
                    </div>

                    <div className="flex items-center gap-2 justify-end">
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="px-3 py-1.5 text-xs text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-100"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        data-testid={`save-dependencies-btn-${story.id}`}
                        disabled={isUpdatingDependencies}
                        onClick={() => handleSaveDependencies(story.id)}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 shadow-xs transition disabled:opacity-50 flex items-center gap-1"
                      >
                        {isUpdatingDependencies ? 'Saving...' : 'Save Dependencies'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Failing Readiness Rules (if unready) */}
                {!isReady && report && report.failures.length > 0 && (
                  <div
                    data-testid="story-readiness-failures"
                    className="mt-3.5 p-3 bg-amber-50/80 border border-amber-200 rounded-lg text-xs"
                  >
                    <div className="font-semibold text-amber-900 mb-1 flex items-center gap-1.5">
                      <span>⚠ Readiness Blockers ({report.failures.length}):</span>
                    </div>
                    <ul className="space-y-1 text-amber-800 list-disc list-inside">
                      {report.failures.map((f) => (
                        <li
                          key={f.ruleId}
                          data-testid="story-readiness-failure"
                          className="leading-normal"
                        >
                          <span className="font-mono font-bold text-amber-950">[{f.ruleId}]</span>:{' '}
                          {f.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Expanded Details: Gherkin Source & Historical Export Audit Trail */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
                    {/* Historical Export Audit Trail */}
                    {staleness?.history && staleness.history.length > 0 && (
                      <div data-testid={`story-export-history-${story.id}`} className="space-y-2">
                        <h4 className="text-xs font-semibold text-gray-700">
                          Export History Audit Trail ({staleness.history.length} versions):
                        </h4>
                        <div className="bg-gray-50 border border-gray-200 rounded-md p-2.5 space-y-2">
                          {staleness.history.map((h) => (
                            <div
                              key={h.exportVersion}
                              data-testid={`export-history-entry-${story.id}-v${h.exportVersion}`}
                              className="text-[11px] font-mono text-gray-700 pb-1.5 border-b border-gray-200 last:border-0 last:pb-0"
                            >
                              <div className="flex items-center justify-between font-semibold">
                                <span>
                                  Export v{h.exportVersion} (Story v{h.storyVersion})
                                </span>
                                <span className="text-gray-500 font-normal">
                                  {new Date(h.exportedAt).toLocaleString()} by {h.exportedBy}
                                </span>
                              </div>
                              <div className="text-gray-600 mt-0.5">
                                Baseline: {h.baselineId} | Hash: {h.exportContentHash.slice(0, 8)}{' '}
                                (v{h.exportContentHashVersion})
                                {h.externalWorkItemId && ` | Item #${h.externalWorkItemId}`}
                              </div>
                              {h.updateRationale && (
                                <div className="text-gray-800 italic mt-0.5 font-sans">
                                  Rationale: {h.updateRationale}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <h4 className="text-xs font-semibold text-gray-700 mb-2">
                        Gherkin Specification:
                      </h4>
                      <pre className="bg-gray-900 text-gray-100 p-3 rounded-md text-xs font-mono overflow-x-auto leading-relaxed">
                        <code>{story.gherkinText}</code>
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Export Confirmation Modal */}
      {exportModalStoryId && (
        <div
          data-testid="export-confirmation-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-gray-200 text-xs">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-900">
                Export Story: {exportModalStoryId}
              </h3>
              <button
                type="button"
                onClick={() => setExportModalStoryId(null)}
                className="text-gray-400 hover:text-gray-600 text-base font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {(() => {
                const modalStoryStaleness = exportModalStoryId
                  ? stalenessMap.get(exportModalStoryId)
                  : undefined;
                const modalStory = exportModalStoryId
                  ? stories.find((s) => s.id === exportModalStoryId)
                  : undefined;
                if (!modalStoryStaleness) return null;

                return (
                  <div
                    data-testid="export-diff-preview"
                    className="p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-2 text-xs"
                  >
                    <div className="font-semibold text-gray-900 flex items-center justify-between">
                      <span>Export Difference Analysis:</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          modalStoryStaleness.classification === 'STALE'
                            ? 'bg-red-100 text-red-800'
                            : modalStoryStaleness.classification === 'IMPACTED'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {modalStoryStaleness.classification}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                      <div className="p-2 bg-white rounded border border-gray-200">
                        <div className="font-sans font-semibold text-gray-500 mb-1">
                          Exported Lineage
                        </div>
                        {modalStoryStaleness.exportedLineage ? (
                          <>
                            <div>Baseline: {modalStoryStaleness.exportedLineage.baselineId}</div>
                            <div>Export: v{modalStoryStaleness.exportedLineage.exportVersion}</div>
                            <div>Story: v{modalStoryStaleness.exportedLineage.storyVersion}</div>
                            <div title={modalStoryStaleness.exportedLineage.exportContentHash}>
                              Hash:{' '}
                              {modalStoryStaleness.exportedLineage.exportContentHash.slice(0, 8)}
                            </div>
                          </>
                        ) : (
                          <div className="text-gray-400 italic font-sans">Never exported</div>
                        )}
                      </div>

                      <div className="p-2 bg-white rounded border border-gray-200">
                        <div className="font-sans font-semibold text-gray-500 mb-1">
                          Current Candidate
                        </div>
                        <div>Baseline: {stalenessReport?.baselineId ?? 'current'}</div>
                        <div>
                          Export: v{(modalStoryStaleness.exportedLineage?.exportVersion ?? 0) + 1}
                        </div>
                        <div>Story: v{modalStory?.version ?? 1}</div>
                        <div title={modalStoryStaleness.currentContentHash}>
                          Hash: {modalStoryStaleness.currentContentHash.slice(0, 8)}
                        </div>
                      </div>
                    </div>

                    {modalStoryStaleness.causes.length > 0 && (
                      <div className="mt-1">
                        <span className="font-semibold text-gray-800">Detected Causes:</span>
                        <ul className="list-disc list-inside mt-1 space-y-0.5 text-gray-600 text-[11px]">
                          {modalStoryStaleness.causes.map((c, i) => (
                            <li key={i}>
                              <span className="font-mono font-bold">[{c.category}]</span>:{' '}
                              {c.message}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })()}
              <div>
                <label
                  htmlFor="export-target-container"
                  className="block text-gray-700 font-medium mb-1"
                >
                  Target Repository / Container:
                </label>
                <input
                  id="export-target-container"
                  data-testid="export-target-input"
                  type="text"
                  value={exportTargetContainer}
                  onChange={(e) => setExportTargetContainer(e.target.value)}
                  className="w-full border border-gray-300 rounded px-2.5 py-1.5 font-mono text-xs focus:ring-2 focus:ring-indigo-500"
                  placeholder="owner/repo"
                />
              </div>

              <div>
                <label className="flex items-center gap-2 cursor-pointer text-gray-700">
                  <input
                    type="checkbox"
                    data-testid="export-allow-update-checkbox"
                    checked={allowUpdateExisting}
                    onChange={(e) => setAllowUpdateExisting(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="font-semibold">Allow Updating Existing Work Item</span>
                </label>
                <p className="text-[11px] text-gray-500 mt-0.5 ml-5">
                  When unchecked, stale or modified stories fail closed and will be skipped.
                </p>
              </div>

              <div>
                <label
                  htmlFor="export-rationale-input"
                  className="block text-gray-700 font-medium mb-1"
                >
                  Update Rationale:
                </label>
                <textarea
                  id="export-rationale-input"
                  data-testid="export-rationale-input"
                  rows={3}
                  value={exportRationale}
                  onChange={(e) => setExportRationale(e.target.value)}
                  className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-indigo-500"
                  placeholder="Document reason for update (e.g., Requirement REQ-1 updated with new compliance rule)"
                />
              </div>

              {exportFeedback && (
                <div
                  className={`p-2.5 rounded text-xs ${
                    exportFeedback.type === 'success'
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-red-50 text-red-800 border border-red-200'
                  }`}
                >
                  {exportFeedback.message}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setExportModalStoryId(null)}
                  className="px-3 py-1.5 text-gray-600 hover:text-gray-900 border border-gray-300 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="confirm-export-btn"
                  disabled={isExporting}
                  onClick={async () => {
                    if (!onExportBacklog) return;
                    setIsExporting(true);
                    setExportFeedback(null);
                    try {
                      const res = await onExportBacklog({
                        targetContainer: exportTargetContainer,
                        storyIds: [exportModalStoryId],
                        allowUpdateExisting,
                        updateRationale: exportRationale.trim() || undefined
                      });
                      const item = res.items[0];
                      if (!item) {
                        setExportFeedback({
                          type: 'error',
                          message: 'No items returned from export'
                        });
                      } else if (item.status === 'skipped-stale') {
                        setExportFeedback({
                          type: 'error',
                          message: `Item skipped (STALE): ${item.message}`
                        });
                      } else if (item.status === 'rejected') {
                        setExportFeedback({
                          type: 'error',
                          message: `Item rejected: ${item.rejectionReasons.join(', ')}`
                        });
                      } else if (item.status === 'failed') {
                        setExportFeedback({
                          type: 'error',
                          message: `Item failed: ${item.errorMessage}`
                        });
                      } else {
                        setExportFeedback({
                          type: 'success',
                          message: `Export successful (${item.status})! Work item: ${item.externalWorkItemId}`
                        });
                        setTimeout(() => {
                          setExportModalStoryId(null);
                        }, 1500);
                      }
                    } catch (err) {
                      setExportFeedback({
                        type: 'error',
                        message: err instanceof Error ? err.message : 'Export failed'
                      });
                    } finally {
                      setIsExporting(false);
                    }
                  }}
                  className="px-3 py-1.5 font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md shadow-xs disabled:opacity-50"
                >
                  {isExporting ? 'Exporting...' : 'Confirm & Export'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
