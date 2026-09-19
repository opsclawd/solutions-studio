'use client';

import React, { useState } from 'react';
import type {
  StoryDto,
  StoryReadinessReportDto,
  BaselineRequirementCoverageDto
} from '@solutions-studio/contracts';

export interface StoryReadinessBacklogSectionProps {
  readonly stories: readonly StoryDto[];
  readonly readinessReports: readonly StoryReadinessReportDto[];
  readonly coverage: BaselineRequirementCoverageDto;
  readonly onUpdateDependencies: (storyId: string, dependencies: string[]) => Promise<void>;
  readonly isUpdatingDependencies?: boolean;
  readonly mutationError?: string | null;
}

export function StoryReadinessBacklogSection({
  stories,
  readinessReports,
  coverage,
  onUpdateDependencies,
  isUpdatingDependencies = false,
  mutationError = null
}: StoryReadinessBacklogSectionProps) {
  const [editingStoryId, setEditingStoryId] = useState<string | null>(null);
  const [editedDependencies, setEditedDependencies] = useState<string[]>([]);
  const [expandedStoryId, setExpandedStoryId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const reportMap = new Map<string, StoryReadinessReportDto>();
  for (const r of readinessReports) {
    reportMap.set(r.storyId, r);
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
            <h2 className="text-base font-bold text-gray-900 tracking-tight flex items-center gap-2">
              <span>Story Readiness & Backlog</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">
                {stories.length} Stories
              </span>
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

                {/* Expanded Details: Gherkin Source */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <h4 className="text-xs font-semibold text-gray-700 mb-2">
                      Gherkin Specification:
                    </h4>
                    <pre className="bg-gray-900 text-gray-100 p-3 rounded-md text-xs font-mono overflow-x-auto leading-relaxed">
                      <code>{story.gherkinText}</code>
                    </pre>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
