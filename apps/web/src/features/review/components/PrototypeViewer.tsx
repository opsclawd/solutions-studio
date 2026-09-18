'use client';

import React, { useState } from 'react';
import type { ProjectionRecordDto } from '@solutions-studio/contracts';
import { SandboxFrame } from '../../prototype-sandbox/SandboxFrame';

export interface PrototypeViewerProps {
  projection: ProjectionRecordDto;
  currentBaselineId?: string;
}

export function PrototypeViewer({ projection, currentBaselineId }: PrototypeViewerProps) {
  const [showRawCode, setShowRawCode] = useState<boolean>(false);

  const handleExportTsx = () => {
    if (!projection.content) return;
    const blob = new Blob([projection.content], { type: 'text/typescript-jsx;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${projection.id}.tsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const metadata = projection.metadata;
  const declaredProvenance = metadata?.declaredProvenance ?? {
    baselineId: projection.baselineId,
    requirementRevisionIds: projection.requirementRevisionIds
  };
  const configuredExecution = metadata?.configuredExecution ?? {
    provider: 'unknown',
    artifactType: projection.artifactType
  };
  const measuredVerification = metadata?.measuredVerification ?? {
    repairsNeeded: 0,
    attemptCount: 1,
    contentHash: 'none',
    verifiedAt: projection.createdAt
  };

  return (
    <div
      data-testid="prototype-viewer"
      className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-xs flex flex-col"
    >
      {/* Provenance & Verification Metadata Bar */}
      <div
        data-testid="projection-provenance-bar"
        className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-gray-700">Baseline:</span>
          <span
            data-testid="projection-baseline-id"
            className="font-mono bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-bold"
          >
            {declaredProvenance.baselineId}
          </span>
          {currentBaselineId && projection.baselineId !== currentBaselineId && (
            <span
              data-testid="projection-staleness-badge"
              className="font-mono bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-bold"
            >
              Prior Baseline ({projection.baselineId})
            </span>
          )}

          <span className="font-semibold text-gray-700 ml-2">Revisions:</span>
          <div data-testid="projection-revisions-list" className="flex flex-wrap gap-1">
            {declaredProvenance.requirementRevisionIds.map((revId) => (
              <span
                key={revId}
                data-testid={`projection-rev-chip-${revId}`}
                className="font-mono bg-gray-200 text-gray-800 px-2 py-0.5 rounded"
              >
                {revId}
              </span>
            ))}
          </div>

          <span className="font-semibold text-gray-700 ml-2">Provider:</span>
          <span
            data-testid="projection-provider"
            className="font-mono bg-purple-100 text-purple-800 px-2 py-0.5 rounded"
          >
            {configuredExecution.provider}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-gray-600">
          <div>
            Repairs:{' '}
            <span
              data-testid="projection-repairs-needed"
              className="font-mono font-semibold text-gray-900"
            >
              {measuredVerification.repairsNeeded}
            </span>
          </div>
          <div>
            Attempts:{' '}
            <span
              data-testid="projection-attempt-count"
              className="font-mono font-semibold text-gray-900"
            >
              {measuredVerification.attemptCount}
            </span>
          </div>
          <div title={measuredVerification.contentHash}>
            Hash:{' '}
            <span data-testid="projection-content-hash" className="font-mono text-gray-700">
              {measuredVerification.contentHash.length > 12
                ? `${measuredVerification.contentHash.slice(0, 10)}...`
                : measuredVerification.contentHash}
            </span>
          </div>
          <div>
            Verified:{' '}
            <span data-testid="projection-verified-at" className="font-mono text-gray-700">
              {new Date(measuredVerification.verifiedAt).toLocaleTimeString()}
            </span>
          </div>
        </div>
      </div>

      {/* Inspection Toolbar: Raw Code Toggle & Export */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-gray-500 font-medium">Interactive Prototype Execution Sandbox</span>
          <span className="text-gray-400 text-xs hidden sm:inline">
            (Isolated null-origin iframe)
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="toggle-raw-code-btn"
            onClick={() => setShowRawCode((prev) => !prev)}
            className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded border border-gray-300 text-gray-700 transition"
          >
            {showRawCode ? 'Hide Code' : 'View Code'}
          </button>
          <button
            type="button"
            data-testid="export-prototype-btn"
            onClick={handleExportTsx}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition shadow-xs"
          >
            Export TSX
          </button>
        </div>
      </div>

      {/* Raw Code Accordion/Drawer if toggled */}
      {showRawCode && (
        <div className="bg-gray-900 text-gray-100 p-4 border-b border-gray-800 text-xs font-mono overflow-x-auto max-h-96">
          <pre data-testid="raw-prototype-code">{projection.content}</pre>
        </div>
      )}

      {/* Sandboxed Prototype Viewport */}
      <div
        data-testid="prototype-sandbox-container"
        className="w-full h-[520px] bg-slate-50 relative p-4 flex flex-col"
      >
        <SandboxFrame
          code={projection.content}
          className="w-full h-full"
          title={`Prototype ${projection.id}`}
        />
      </div>
    </div>
  );
}
