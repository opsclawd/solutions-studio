'use client';

import React from 'react';
import type { EvidenceReferenceDto, EvidenceExcerptDto } from '@solutions-studio/contracts';

export interface EvidencePanelProps {
  evidence: readonly EvidenceReferenceDto[];
  evidenceByKey: ReadonlyMap<string, EvidenceExcerptDto>;
}

export function EvidencePanel({ evidence, evidenceByKey }: EvidencePanelProps) {
  if (!evidence || evidence.length === 0) {
    return (
      <div
        data-testid="evidence-panel-empty"
        className="p-4 bg-gray-50 border border-dashed border-gray-200 rounded text-xs text-gray-500 italic"
      >
        No direct evidence attached to this requirement.
      </div>
    );
  }

  return (
    <div data-testid="evidence-panel" className="space-y-3">
      {evidence.map((ref, idx) => {
        const key = `${ref.sourceRevisionId}::${ref.locator}`;
        const excerpt = evidenceByKey.get(key);

        return (
          <div
            key={`${key}-${idx}`}
            data-testid="evidence-item"
            className="border border-gray-200 rounded-lg p-3.5 bg-gray-50 text-xs shadow-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-800 font-mono text-[11px] bg-white px-2 py-0.5 rounded border border-gray-200">
                  {ref.locator}
                </span>
                <span className="text-gray-500 text-[11px] font-mono">
                  Source: {ref.sourceRevisionId}
                </span>
              </div>
              {excerpt?.headingPath && (
                <span className="text-gray-600 font-medium text-[11px] truncate max-w-md">
                  {excerpt.headingPath}
                </span>
              )}
            </div>

            {excerpt ? (
              <div>
                <blockquote
                  data-testid="evidence-excerpt-text"
                  className="bg-white p-2.5 rounded border-l-3 border-blue-500 text-gray-800 font-mono whitespace-pre-wrap text-[11px] leading-relaxed"
                >
                  {excerpt.text}
                </blockquote>
                <div className="mt-2 flex items-center justify-between text-[10px] text-gray-400">
                  <span>
                    Lines {excerpt.startLine}–{excerpt.endLine}
                  </span>
                  {excerpt.blockLabel && (
                    <span className="bg-gray-100 px-1.5 py-0.5 rounded">{excerpt.blockLabel}</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-amber-700 bg-amber-50 p-2 rounded text-[11px] italic">
                Source excerpt not resolved for locator &apos;{ref.locator}&apos;.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
