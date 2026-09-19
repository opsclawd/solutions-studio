import React, { Suspense } from 'react';
import { ReviewWorkspace } from '@/features/review/components/ReviewWorkspace';

interface ReviewPageProps {
  searchParams?: {
    baselineId?: string;
  };
}

export default function ReviewPage({ searchParams }: ReviewPageProps) {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-500">Loading workspace...</div>}>
      <ReviewWorkspace baselineId={searchParams?.baselineId} />
    </Suspense>
  );
}
