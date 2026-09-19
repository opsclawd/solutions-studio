'use client';

import React from 'react';
import type { RequirementRevisionDto } from '@solutions-studio/contracts';
import { getOriginBadge, getReviewStateBadge, getResolutionStateBadge } from './badges';

export interface RequirementListProps {
  revisions: readonly RequirementRevisionDto[];
  selectedRequirementId?: string;
  onSelect: (requirementId: string) => void;
}

export function RequirementList({
  revisions,
  selectedRequirementId,
  onSelect
}: RequirementListProps) {
  if (revisions.length === 0) {
    return (
      <div
        data-testid="requirement-list-empty"
        className="p-6 text-center text-gray-500 text-xs italic bg-white rounded-lg border border-gray-200"
      >
        No requirements found in current view.
      </div>
    );
  }

  return (
    <div
      data-testid="requirement-list"
      className="divide-y divide-gray-100 bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs"
    >
      {revisions.map((rev) => {
        const isSelected = rev.requirementId === selectedRequirementId;
        const originBadge = getOriginBadge(rev.origin);
        const reviewBadge = getReviewStateBadge(rev.reviewState);
        const resolutionBadge = getResolutionStateBadge(rev.resolutionState);

        return (
          <div
            key={rev.requirementId}
            data-testid="requirement-row"
            data-requirement-id={rev.requirementId}
            data-revision-id={rev.id}
            onClick={() => onSelect(rev.requirementId)}
            className={`p-4 cursor-pointer transition flex flex-col gap-2 ${
              isSelected ? 'bg-blue-50/70 border-l-4 border-blue-600 pl-3' : 'hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  data-testid="req-row-id"
                  className="font-mono font-bold text-xs text-gray-900"
                >
                  {rev.requirementId}
                </span>
                <span
                  data-testid="req-row-revision-badge"
                  className="font-mono text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200"
                >
                  {rev.id}
                </span>
              </div>
              <span
                data-testid="req-row-review-badge"
                className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${reviewBadge.className}`}
              >
                {reviewBadge.label}
              </span>
            </div>

            <p
              data-testid="req-row-statement"
              className="text-xs text-gray-700 line-clamp-2 leading-relaxed"
            >
              {rev.statement}
            </p>

            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span
                data-testid="req-row-origin-badge"
                className={`px-1.5 py-0.2 rounded border text-[9px] font-medium ${originBadge.className}`}
              >
                {originBadge.label}
              </span>
              <span
                data-testid="req-row-resolution-badge"
                className={`px-1.5 py-0.2 rounded border text-[9px] font-medium ${resolutionBadge.className}`}
              >
                {resolutionBadge.label}
              </span>
              <span className="text-[10px] text-gray-400 ml-auto font-mono">{rev.category}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
