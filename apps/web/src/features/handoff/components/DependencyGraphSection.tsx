'use client';

import React, { useState } from 'react';
import type { StoryDependencyGraphDto } from '@solutions-studio/contracts';
import { computeExecutionStages } from './graphStages';

export interface DependencyGraphSectionProps {
  readonly graph: StoryDependencyGraphDto;
}

export function DependencyGraphSection({ graph }: DependencyGraphSectionProps) {
  const [showRawJson, setShowRawJson] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  const stages = computeExecutionStages(graph);
  const nodeMap = new Map(graph.nodes.map((n) => [n.storyId, n]));

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(graph, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  return (
    <div
      data-testid="dependency-graph-section"
      className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden"
    >
      {/* Section Header */}
      <div className="border-b border-gray-200 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <span>Story Execution Graph</span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                graph.isAcyclic ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
              }`}
            >
              {graph.isAcyclic ? 'Strict DAG' : 'Cycle Detected'}
            </span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Deterministic topological execution order (Kahn algorithm) with prerequisite ➔ dependent
            edges
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="raw-json-drawer-btn"
            onClick={() => setShowRawJson((prev) => !prev)}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-xs transition"
          >
            {showRawJson ? 'Hide Graph JSON' : 'Inspect Graph JSON'}
          </button>
        </div>
      </div>

      {/* Cycle Warning Banner */}
      {graph.hasCycles && (
        <div className="p-6 bg-red-50/90 border-b border-red-200 text-xs text-red-900 space-y-2">
          <div className="font-bold flex items-center gap-2 text-red-800">
            <svg
              className="w-4 h-4 text-red-600 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <span>Topological Sorting Invariant Failed: Cycles Found</span>
          </div>
          <p className="text-red-700">
            The dependency graph contains closed loops. Strict safety invariants mandate that
            execution order is suppressed (empty list) until all cycles are resolved.
          </p>
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <span className="font-semibold text-red-900">Offending Cycles:</span>
            {graph.cycles.map((cycle, idx) => (
              <span
                key={idx}
                className="font-mono bg-white px-2 py-1 rounded border border-red-300 text-red-800 font-bold shadow-xs"
              >
                {cycle.join(' ➔ ')}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Main Graph Content */}
      <div className="p-6 space-y-8">
        {/* Topological Execution Stages Lanes */}
        {stages.length > 0 ? (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                Parallel Execution Stages ({stages.length} Stages • {graph.executionOrder.length}{' '}
                Stories)
              </h3>
              <span className="text-xs text-gray-500 font-mono">
                Order: [{graph.executionOrder.join(', ')}]
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {stages.map((lane) => (
                <div
                  key={lane.stage}
                  data-testid={`graph-stage-lane-${lane.stage}`}
                  className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex flex-col"
                >
                  <div className="flex items-center justify-between border-b border-gray-200 pb-2 mb-3">
                    <span className="text-xs font-bold text-gray-700">Stage {lane.stage}</span>
                    <span className="text-[11px] font-medium text-gray-500 bg-white px-1.5 py-0.5 rounded border border-gray-200">
                      {lane.storyIds.length} {lane.storyIds.length === 1 ? 'story' : 'stories'}
                    </span>
                  </div>

                  <div className="space-y-2 flex-1">
                    {lane.storyIds.map((storyId) => {
                      const node = nodeMap.get(storyId);
                      const isReady = node?.isReady ?? false;
                      const orderIndex = graph.executionOrder.indexOf(storyId) + 1;

                      return (
                        <div
                          key={storyId}
                          data-testid={`graph-node-${storyId}`}
                          className="bg-white border border-gray-200 rounded-md p-2.5 shadow-2xs hover:shadow-xs transition text-xs"
                        >
                          <div className="flex items-center justify-between gap-1 mb-1">
                            <div className="flex items-center gap-1.5">
                              <span className="w-5 h-5 rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-bold flex items-center justify-center font-mono">
                                #{orderIndex}
                              </span>
                              <span className="font-mono font-bold text-gray-900">{storyId}</span>
                            </div>
                            <span
                              className={`w-2 h-2 rounded-full ${
                                isReady ? 'bg-emerald-500' : 'bg-amber-500'
                              }`}
                              title={isReady ? 'Ready' : 'Not Ready'}
                            />
                          </div>

                          <div className="font-medium text-gray-800 line-clamp-1">
                            {node?.title}
                          </div>

                          {node && node.dependencies.length > 0 && (
                            <div className="mt-2 pt-1.5 border-t border-gray-100 flex items-center gap-1 flex-wrap text-[10px] text-gray-500">
                              <span>Prereqs:</span>
                              {node.dependencies.map((d) => (
                                <span
                                  key={d}
                                  className="font-mono bg-gray-100 px-1 py-0.5 rounded text-gray-700"
                                >
                                  {d}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : !graph.hasCycles ? (
          <div className="p-8 text-center text-xs text-gray-500 bg-gray-50 rounded-lg border border-dashed border-gray-200">
            No stories in dependency graph.
          </div>
        ) : null}

        {/* Directed Edges Table */}
        {graph.edges.length > 0 && (
          <div className="border-t border-gray-100 pt-6">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">
              Directed Dependency Edges ({graph.edges.length})
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {graph.edges.map((edge, i) => (
                <div
                  key={i}
                  data-testid="graph-edge-item"
                  className="flex items-center justify-between p-2.5 bg-gray-50 border border-gray-200 rounded-md text-xs font-mono"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 text-[10px]">Prereq:</span>
                    <span className="font-bold text-gray-800">{edge.from}</span>
                  </div>
                  <span className="text-indigo-600 font-bold">➔</span>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 text-[10px]">Dependent:</span>
                    <span className="font-bold text-gray-800">{edge.to}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Raw JSON Drawer / Viewer */}
        {showRawJson && (
          <div data-testid="raw-json-drawer" className="border-t border-gray-100 pt-6 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                Machine-Readable Graph JSON
              </h3>
              <button
                type="button"
                onClick={handleCopyJson}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
              >
                {copiedJson ? 'Copied!' : 'Copy JSON'}
              </button>
            </div>
            <pre
              data-testid="raw-graph-json"
              className="bg-gray-950 text-gray-100 p-4 rounded-lg text-xs font-mono overflow-x-auto max-h-[400px] leading-relaxed"
            >
              <code>{JSON.stringify(graph, null, 2)}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
