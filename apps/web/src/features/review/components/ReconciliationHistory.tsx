'use client';

import React from 'react';
import type { ReconciliationRecordDto } from '@solutions-studio/contracts';

export interface ReconciliationHistoryProps {
  records: readonly ReconciliationRecordDto[];
}

export function ReconciliationHistory({ records }: ReconciliationHistoryProps) {
  if (!records || records.length === 0) {
    return (
      <div
        data-testid="history-empty"
        className="p-4 bg-gray-50 border border-dashed border-gray-200 rounded text-xs text-gray-500 italic"
      >
        No reconciliation actions recorded yet.
      </div>
    );
  }

  // Newest first
  const sorted = [...records].sort((a, b) => {
    return new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime();
  });

  return (
    <div data-testid="reconciliation-history" className="space-y-3">
      {sorted.map((record) => {
        const isReq = record.entityType === 'requirement';

        return (
          <div
            key={record.id}
            data-testid="history-record"
            className="border-l-2 border-blue-400 pl-3 py-1 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-gray-500 mb-1">
              <div className="flex items-center gap-1.5">
                <span
                  data-testid="history-action-badge"
                  className="font-bold text-gray-800 bg-gray-100 px-1.5 py-0.5 rounded text-[10px]"
                >
                  {isReq
                    ? record.action
                    : `${record.previousDisposition} → ${record.newDisposition}`}
                </span>
                {isReq && (
                  <span className="font-mono text-blue-700">
                    produced revision {record.requirementRevisionId}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-gray-400">
                {record.actorId && <span>by {record.actorId}</span>}
                <span>{new Date(record.recordedAt).toLocaleString()}</span>
              </div>
            </div>

            <p
              data-testid="history-rationale"
              className="text-gray-700 italic bg-gray-50 p-2 rounded"
            >
              &ldquo;{record.rationale}&rdquo;
            </p>
          </div>
        );
      })}
    </div>
  );
}
