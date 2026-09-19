'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  EngineeringHandoffBundleDto,
  StoryDto,
  StoryReadinessReportDto
} from '@solutions-studio/contracts';
import {
  getEngineeringHandoffBundle,
  updateStoryDependencies,
  listAvailableBaselines
} from '../api/handoffApi';

export type HandoffTab = 'overview' | 'authority' | 'projections' | 'stories' | 'graph';

export interface UseHandoffStateReturn {
  readonly status: 'idle' | 'loading' | 'success' | 'error';
  readonly error: string | null;
  readonly bundle: EngineeringHandoffBundleDto | null;
  readonly activeBaselineId: string | null;
  readonly availableBaselines: readonly string[];
  readonly activeTab: HandoffTab;
  readonly selectedStoryId: string | null;
  readonly selectedStory: StoryDto | null;
  readonly selectedStoryReadiness: StoryReadinessReportDto | null;
  readonly isUpdatingDependencies: boolean;
  readonly updateDependenciesError: string | null;
  readonly selectBaseline: (baselineId: string) => void;
  readonly setActiveTab: (tab: HandoffTab) => void;
  readonly selectStory: (storyId: string | null) => void;
  readonly refresh: () => Promise<void>;
  readonly mutateStoryDependencies: (
    storyId: string,
    dependencies: string[]
  ) => Promise<StoryDto | undefined>;
  readonly clearMutationError: () => void;
}

export function useHandoffState(initialBaselineId?: string): UseHandoffStateReturn {
  const [activeBaselineId, setActiveBaselineId] = useState<string | null>(
    initialBaselineId ?? null
  );
  const [availableBaselines, setAvailableBaselines] = useState<string[]>([]);
  const [bundle, setBundle] = useState<EngineeringHandoffBundleDto | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<HandoffTab>('overview');
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);
  const [isUpdatingDependencies, setIsUpdatingDependencies] = useState(false);
  const [updateDependenciesError, setUpdateDependenciesError] = useState<string | null>(null);

  const requestSeqRef = useRef<number>(0);
  const activeBaselineIdRef = useRef<string | null>(initialBaselineId ?? null);

  // Load available baselines on mount
  useEffect(() => {
    let cancelled = false;
    async function loadBaselines() {
      try {
        const ids = await listAvailableBaselines();
        if (!cancelled) {
          setAvailableBaselines(ids);
          if (!activeBaselineIdRef.current && ids.length > 0) {
            activeBaselineIdRef.current = ids[0];
            setActiveBaselineId(ids[0]);
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load baselines', err);
        }
      }
    }
    loadBaselines();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch handoff bundle whenever activeBaselineId changes
  const fetchBundle = useCallback(async (baselineId: string) => {
    const seq = ++requestSeqRef.current;
    setStatus('loading');
    setError(null);
    try {
      const data = await getEngineeringHandoffBundle(baselineId);
      if (seq === requestSeqRef.current && activeBaselineIdRef.current === baselineId) {
        setBundle(data);
        setStatus('success');
      }
    } catch (err) {
      if (seq === requestSeqRef.current && activeBaselineIdRef.current === baselineId) {
        const msg =
          err instanceof Error ? err.message : 'Failed to load engineering handoff bundle';
        setError(msg);
        setStatus('error');
      }
    }
  }, []);

  useEffect(() => {
    activeBaselineIdRef.current = activeBaselineId;
    if (activeBaselineId) {
      fetchBundle(activeBaselineId);
    }
  }, [activeBaselineId, fetchBundle]);

  const selectBaseline = useCallback((id: string) => {
    activeBaselineIdRef.current = id;
    setActiveBaselineId(id);
    setSelectedStoryId(null);
    setUpdateDependenciesError(null);
  }, []);

  const selectStory = useCallback((id: string | null) => {
    setSelectedStoryId(id);
  }, []);

  const refresh = useCallback(async () => {
    const current = activeBaselineIdRef.current;
    if (current) {
      await fetchBundle(current);
    }
  }, [fetchBundle]);

  const mutateStoryDependencies = useCallback(
    async (storyId: string, dependencies: string[]): Promise<StoryDto | undefined> => {
      setIsUpdatingDependencies(true);
      setUpdateDependenciesError(null);
      try {
        const updated = await updateStoryDependencies(storyId, dependencies);
        // Refresh bundle to synchronize graph, summary, and stories if still on same baseline
        const currentBaseline = activeBaselineIdRef.current;
        if (currentBaseline && updated.baselineId === currentBaseline) {
          await fetchBundle(currentBaseline);
        }
        return updated;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to update story dependencies';
        setUpdateDependenciesError(msg);
        throw err;
      } finally {
        setIsUpdatingDependencies(false);
      }
    },
    [fetchBundle]
  );

  const clearMutationError = useCallback(() => {
    setUpdateDependenciesError(null);
  }, []);

  const selectedStory = bundle?.stories.find((s) => s.id === selectedStoryId) ?? null;
  const selectedStoryReadiness =
    bundle?.readinessReports.find((r) => r.storyId === selectedStoryId) ?? null;

  return {
    status,
    error,
    bundle,
    activeBaselineId,
    availableBaselines,
    activeTab,
    selectedStoryId,
    selectedStory,
    selectedStoryReadiness,
    isUpdatingDependencies,
    updateDependenciesError,
    selectBaseline,
    setActiveTab,
    selectStory,
    refresh,
    mutateStoryDependencies,
    clearMutationError
  };
}
