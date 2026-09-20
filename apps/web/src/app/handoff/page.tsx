import React, { Suspense } from 'react';
import { EngineeringHandoffWorkspace } from '@/features/handoff/components/EngineeringHandoffWorkspace';

interface HandoffPageProps {
  searchParams?: {
    baselineId?: string;
    candidateSha?: string;
  };
}

export default function HandoffPage({ searchParams }: HandoffPageProps) {
  return (
    <Suspense
      fallback={<div className="p-8 text-center text-gray-500">Loading handoff workspace...</div>}
    >
      <EngineeringHandoffWorkspace
        baselineId={searchParams?.baselineId}
        candidateSha={searchParams?.candidateSha}
      />
    </Suspense>
  );
}
