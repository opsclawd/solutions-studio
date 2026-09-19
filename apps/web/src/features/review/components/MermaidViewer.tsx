'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { ProjectionRecordDto } from '@solutions-studio/contracts';

export interface MermaidViewerProps {
  projection: ProjectionRecordDto;
  currentBaselineId?: string;
}

export function MermaidViewer({ projection, currentBaselineId }: MermaidViewerProps) {
  const [svgContent, setSvgContent] = useState<string>('');
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState<boolean>(true);
  const [zoom, setZoom] = useState<number>(1.0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showRawCode, setShowRawCode] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let isMounted = true;
    setIsRendering(true);
    setRenderError(null);

    async function renderMermaid() {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'loose'
        });

        const safeId = `mermaid-${projection.id.replace(/[^a-zA-Z0-9_-]/g, '_')}-${Date.now()}`;
        const { svg } = await mermaid.render(safeId, projection.content);
        if (isMounted) {
          setSvgContent(svg);
          setRenderError(null);
          setIsRendering(false);
        }
      } catch (err) {
        if (isMounted) {
          setRenderError(err instanceof Error ? err.message : String(err));
          setIsRendering(false);
        }
      }
    }

    renderMermaid();

    return () => {
      isMounted = false;
    };
  }, [projection.id, projection.content]);

  // Pan interaction handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only drag with primary mouse button
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Zoom handlers
  const handleZoomIn = () => {
    setZoom((prev) => Math.min(3.0, +(prev + 0.2).toFixed(1)));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(0.4, +(prev - 0.2).toFixed(1)));
  };

  const handleZoomReset = () => {
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
  };

  // SVG export handler
  const handleExportSvg = () => {
    let svgString = svgContent;
    if (svgRef.current) {
      const svgElement = svgRef.current.querySelector('svg');
      if (svgElement) {
        svgString = svgElement.outerHTML;
      }
    }

    if (!svgString) return;

    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${projection.id}.svg`;
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
      data-testid="mermaid-viewer"
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

      {/* Inspection Toolbar: Pan/Zoom & Actions */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="zoom-out-btn"
            onClick={handleZoomOut}
            className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded border border-gray-300 font-bold text-gray-700 transition"
            title="Zoom Out"
          >
            −
          </button>
          <span
            data-testid="zoom-level-text"
            className="font-mono font-medium px-2 py-0.5 bg-gray-50 border border-gray-200 rounded text-center w-14"
          >
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            data-testid="zoom-in-btn"
            onClick={handleZoomIn}
            className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded border border-gray-300 font-bold text-gray-700 transition"
            title="Zoom In"
          >
            +
          </button>
          <button
            type="button"
            data-testid="zoom-reset-btn"
            onClick={handleZoomReset}
            className="ml-1 px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded border border-gray-300 text-gray-700 transition"
            title="Reset Zoom & Pan"
          >
            Reset
          </button>
          <span className="text-gray-400 ml-2 text-xs hidden sm:inline">(Drag to pan canvas)</span>
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
            data-testid="export-svg-btn"
            onClick={handleExportSvg}
            disabled={!svgContent || !!renderError}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium disabled:opacity-50 transition shadow-xs"
          >
            Export SVG
          </button>
        </div>
      </div>

      {/* Raw Code Accordion/Drawer if toggled */}
      {showRawCode && (
        <div className="bg-gray-900 text-gray-100 p-4 border-b border-gray-800 text-xs font-mono overflow-x-auto">
          <pre data-testid="raw-mermaid-code">{projection.content}</pre>
        </div>
      )}

      {/* Diagram Canvas */}
      <div
        ref={containerRef}
        data-testid="diagram-canvas-container"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className={`relative w-full h-[480px] bg-slate-50 overflow-hidden flex items-center justify-center select-none ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        {isRendering && !svgContent && (
          <div
            data-testid="diagram-rendering-spinner"
            className="text-gray-500 font-medium text-sm animate-pulse"
          >
            Rendering Mermaid diagram...
          </div>
        )}

        {renderError && (
          <div
            data-testid="diagram-render-error"
            className="p-6 max-w-lg bg-red-50 border border-red-200 rounded-lg text-red-800 text-xs text-left"
          >
            <h4 className="font-bold text-sm mb-1">Mermaid Render Error</h4>
            <p className="mb-2">{renderError}</p>
            <div className="font-mono bg-white p-2 rounded border border-red-200 overflow-x-auto">
              <pre>{projection.content}</pre>
            </div>
          </div>
        )}

        {!renderError && svgContent && (
          <div
            ref={svgRef}
            data-testid="diagram-svg-wrapper"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
              transition: isDragging ? 'none' : 'transform 0.1s ease-out'
            }}
            className="pointer-events-none w-full h-full flex items-center justify-center p-4"
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
        )}
      </div>
    </div>
  );
}
