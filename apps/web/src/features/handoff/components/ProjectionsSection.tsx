'use client';

import React, { useState } from 'react';
import type { ProjectionRecordDto, StoryDto } from '@solutions-studio/contracts';

export interface ProjectionsSectionProps {
  readonly sqlProjection?: ProjectionRecordDto;
  readonly openApiProjection?: ProjectionRecordDto;
  readonly stories: readonly StoryDto[];
}

export function ProjectionsSection({
  sqlProjection,
  openApiProjection,
  stories
}: ProjectionsSectionProps) {
  const [activeTab, setActiveTab] = useState<'sql' | 'openapi' | 'stories'>('sql');
  const [copied, setCopied] = useState(false);

  const combinedStoriesGherkin = stories
    .map((s) => `# Story: ${s.id} - ${s.title}\n${s.gherkinText}`)
    .join('\n\n---\n\n');

  let currentContent = '';
  if (activeTab === 'sql') {
    currentContent = sqlProjection?.content ?? '';
  } else if (activeTab === 'openapi') {
    currentContent = openApiProjection?.content ?? '';
  } else {
    currentContent = combinedStoriesGherkin;
  }

  const handleCopy = () => {
    if (!currentContent) return;
    navigator.clipboard.writeText(currentContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      data-testid="projections-section"
      className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden"
    >
      {/* Header & Tabs */}
      <div className="border-b border-gray-200 px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <span>Projection Contracts</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">
              Verified Code
            </span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Deterministic technical projections derived from authoritative requirements
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-gray-100 p-1 rounded-lg text-xs font-medium">
            <button
              type="button"
              data-testid="projections-tab-sql"
              onClick={() => setActiveTab('sql')}
              className={`px-3 py-1 rounded-md transition flex items-center gap-1.5 ${
                activeTab === 'sql'
                  ? 'bg-white text-gray-900 shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span>SQL Schema</span>
              {sqlProjection && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Generated" />
              )}
            </button>
            <button
              type="button"
              data-testid="projections-tab-openapi"
              onClick={() => setActiveTab('openapi')}
              className={`px-3 py-1 rounded-md transition flex items-center gap-1.5 ${
                activeTab === 'openapi'
                  ? 'bg-white text-gray-900 shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span>OpenAPI Spec</span>
              {openApiProjection && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Generated" />
              )}
            </button>
            <button
              type="button"
              data-testid="projections-tab-gherkin"
              onClick={() => setActiveTab('stories')}
              className={`px-3 py-1 rounded-md transition ${
                activeTab === 'stories'
                  ? 'bg-white text-gray-900 shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Gherkin Stories ({stories.length})
            </button>
          </div>

          <button
            type="button"
            data-testid="copy-projection-code-btn"
            onClick={handleCopy}
            disabled={!currentContent}
            className="px-3 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-xs transition disabled:opacity-50"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Code / Content Area */}
      <div className="p-6">
        {activeTab === 'sql' && !sqlProjection && (
          <div
            data-testid="sql-empty-state"
            className="p-8 text-center bg-gray-50 rounded-lg border border-dashed border-gray-300 text-xs text-gray-500"
          >
            <p className="font-semibold text-gray-700">No SQL Schema Projection Available</p>
            <p className="mt-1">
              A database schema projection has not been generated for this baseline.
            </p>
          </div>
        )}

        {activeTab === 'openapi' && !openApiProjection && (
          <div
            data-testid="openapi-empty-state"
            className="p-8 text-center bg-gray-50 rounded-lg border border-dashed border-gray-300 text-xs text-gray-500"
          >
            <p className="font-semibold text-gray-700">No OpenAPI Contract Available</p>
            <p className="mt-1">
              An API specification projection has not been generated for this baseline.
            </p>
          </div>
        )}

        {activeTab === 'stories' && stories.length === 0 && (
          <div
            data-testid="stories-empty-state"
            className="p-8 text-center bg-gray-50 rounded-lg border border-dashed border-gray-300 text-xs text-gray-500"
          >
            <p className="font-semibold text-gray-700">No Stories Generated</p>
            <p className="mt-1">
              Generate stories from the baseline in the reconciliation workspace.
            </p>
          </div>
        )}

        {currentContent && (
          <div
            data-testid={
              activeTab === 'sql'
                ? 'projection-content-sql'
                : activeTab === 'openapi'
                  ? 'projection-content-openapi'
                  : 'projection-content-gherkin'
            }
            className="relative"
          >
            <pre
              data-testid="projection-code-viewer"
              className="bg-gray-950 text-gray-100 p-4 rounded-lg text-xs font-mono overflow-x-auto max-h-[500px] leading-relaxed select-text"
            >
              <code>{currentContent}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
