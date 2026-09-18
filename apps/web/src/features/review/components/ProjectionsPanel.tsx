'use client';

import React, { useState } from 'react';
import type { ProjectionRecordDto } from '@solutions-studio/contracts';
import { MermaidViewer } from './MermaidViewer';
import { DiagramDiscoveryPanel } from './DiagramDiscoveryPanel';
import { PrototypeViewer } from './PrototypeViewer';
import { PrototypeDiscoveryPanel } from './PrototypeDiscoveryPanel';
import type { ApiError } from '../api/client';

export interface ProjectionsPanelProps {
  baselineId?: string;
  projections: readonly ProjectionRecordDto[];
  selectedProjectionId?: string;
  actorId?: string;
  onSelectProjection: (id: string) => void;
  onGenerateProjection: (
    artifactType: 'process-diagram' | 'state-diagram' | 'prototype',
    prompt?: string
  ) => Promise<ProjectionRecordDto>;
  onRefreshWorkspace: () => void | Promise<void>;
}

export function ProjectionsPanel({
  baselineId,
  projections,
  selectedProjectionId,
  actorId,
  onSelectProjection,
  onGenerateProjection,
  onRefreshWorkspace
}: ProjectionsPanelProps) {
  const [artifactType, setArtifactType] = useState<
    'process-diagram' | 'state-diagram' | 'prototype'
  >('process-diagram');
  const [prompt, setPrompt] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  if (!baselineId) {
    return (
      <div
        data-testid="no-baseline-warning"
        className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center text-amber-800"
      >
        <h3 className="font-bold text-sm mb-1">No Baseline Selected</h3>
        <p className="text-xs">
          Diagram projections must be anchored to an immutable requirements baseline. Please select
          or provide a baseline ID to view or generate projections.
        </p>
      </div>
    );
  }

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isGenerating) return;

    setIsGenerating(true);
    setGenerationError(null);

    try {
      await onGenerateProjection(artifactType, prompt.trim() || undefined);
      setPrompt('');
    } catch (err) {
      const apiErr = err as ApiError;
      const errorMsg =
        apiErr.message ||
        (apiErr.details ? JSON.stringify(apiErr.details) : 'Failed to generate diagram projection');
      setGenerationError(errorMsg);
    } finally {
      setIsGenerating(false);
    }
  };

  const activeProjection = projections.find((p) => p.id === selectedProjectionId) ?? projections[0];

  return (
    <div data-testid="projections-panel" className="space-y-6">
      {/* Active Baseline Header & Generator Card */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-gray-200">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-gray-900">Baseline Diagram Projections</h2>
              <span
                data-testid="projection-active-baseline"
                className="bg-blue-100 text-blue-800 text-xs font-mono font-bold px-2.5 py-0.5 rounded"
              >
                {baselineId}
              </span>
              <span data-testid="projections-baseline-badge" className="sr-only">
                {baselineId}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Deterministic Mermaid process and state visualizations projected from frozen baseline
              requirements.
            </p>
          </div>
        </div>

        {/* Generation Form */}
        <form
          data-testid="generate-projection-form"
          onSubmit={handleGenerate}
          className="mt-4 grid grid-cols-1 md:grid-cols-12 gap-4 items-end"
        >
          <div className="md:col-span-3">
            <label className="block text-xs font-semibold text-gray-700 mb-1">Diagram Type</label>
            <select
              data-testid="projection-type-select"
              value={artifactType}
              onChange={(e) =>
                setArtifactType(e.target.value as 'process-diagram' | 'state-diagram' | 'prototype')
              }
              className="w-full text-xs p-2.5 bg-white border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-hidden font-medium"
            >
              <option value="process-diagram">Process Diagram</option>
              <option value="state-diagram">State Diagram</option>
              <option value="prototype">Interactive Prototype (TSX)</option>
            </select>
          </div>

          <div className="md:col-span-6">
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Custom Prompt Instructions (Optional)
            </label>
            <input
              type="text"
              data-testid="projection-prompt-input"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Focus on authentication and admin approval branch"
              className="w-full text-xs p-2.5 border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-hidden"
            />
          </div>

          <div className="md:col-span-3">
            <button
              type="submit"
              data-testid="submit-generate-projection-btn"
              disabled={isGenerating}
              className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition shadow-xs flex items-center justify-center gap-2"
            >
              {isGenerating ? (
                <>
                  <span className="animate-spin h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full" />
                  Generating...
                </>
              ) : (
                'Generate Projection'
              )}
            </button>
          </div>
        </form>

        {generationError && (
          <div
            data-testid="projection-generation-error"
            className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-xs flex items-center justify-between"
          >
            <span>✕ {generationError}</span>
            <button
              type="button"
              onClick={() => setGenerationError(null)}
              className="text-red-600 hover:text-red-800 font-bold ml-2"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Projection Selector Tabs */}
      {projections.length > 0 && (
        <div data-testid="projection-selector" className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-semibold text-gray-500 mr-2">Available Projections:</span>
          {projections.map((proj) => {
            const isSelected = activeProjection?.id === proj.id;
            return (
              <button
                key={proj.id}
                type="button"
                data-testid={`projection-option-${proj.id}`}
                onClick={() => onSelectProjection(proj.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium border transition ${
                  isSelected
                    ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-xs'
                    : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="font-bold">{proj.id}</span>{' '}
                <span className="text-gray-400">({proj.artifactType})</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Viewer & Discovery Area */}
      {activeProjection ? (
        activeProjection.artifactType === 'prototype' ? (
          <div>
            <PrototypeViewer projection={activeProjection} />
            <PrototypeDiscoveryPanel
              projection={activeProjection}
              actorId={actorId}
              onDiscoveryRecorded={onRefreshWorkspace}
            />
          </div>
        ) : (
          <div>
            <MermaidViewer projection={activeProjection} />
            <DiagramDiscoveryPanel
              projection={activeProjection}
              actorId={actorId}
              onDiscoveryRecorded={onRefreshWorkspace}
            />
          </div>
        )
      ) : (
        <div
          data-testid="no-projections-message"
          className="bg-white border border-gray-200 rounded-xl p-12 text-center text-gray-500"
        >
          No diagram projections available for baseline{' '}
          <span className="font-mono">{baselineId}</span>. Use the form above to generate one.
        </div>
      )}
    </div>
  );
}
