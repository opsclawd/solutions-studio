'use client';

import React from 'react';
import type { CandidateFindingDto } from '@solutions-studio/contracts';
import type { FindingDisposition } from '@solutions-studio/domain';
import { FindingItem } from './FindingItem';

export interface FindingsPanelProps {
  requirementId: string;
  findings: readonly CandidateFindingDto[];
  actorId?: string;
  onDisposition: (
    findingId: string,
    disposition: FindingDisposition,
    rationale: string
  ) => Promise<void>;
  onReopen: (findingId: string, rationale?: string) => Promise<void>;
}

export function FindingsPanel({
  requirementId,
  findings,
  actorId,
  onDisposition,
  onReopen
}: FindingsPanelProps) {
  if (findings.length === 0) {
    return (
      <div
        data-testid="findings-panel-empty"
        className="p-4 bg-emerald-50 border border-dashed border-emerald-200 rounded text-xs text-emerald-800 italic"
      >
        No open or recorded findings for requirement {requirementId}.
      </div>
    );
  }

  return (
    <div data-testid="findings-panel" className="space-y-3">
      {findings.map((finding) => (
        <FindingItem
          key={finding.id}
          finding={finding}
          actorId={actorId}
          onDisposition={onDisposition}
          onReopen={onReopen}
        />
      ))}
    </div>
  );
}
