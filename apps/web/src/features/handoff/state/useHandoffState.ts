'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  EngineeringHandoffBundleDto,
  StoryDto,
  StoryReadinessReportDto,
  CandidatePromotionStatusDto,
  ValidationRunRecordDto,
  CandidateApprovalRecordDto,
  BaselineExportStalenessReportDto,
  ExportBacklogRequestDto,
  ExportBacklogResponseDto
} from '@solutions-studio/contracts';
import {
  getEngineeringHandoffBundle,
  updateStoryDependencies,
  listAvailableBaselines,
  getCurrentCandidateSha,
  getCandidatePromotionStatus,
  listValidationRuns,
  listGovernanceApprovals,
  createGovernanceApproval,
  revokeGovernanceApproval,
  exportGovernanceAudit,
  getExportStaleness,
  exportBacklog
} from '../api/handoffApi';

export type HandoffTab =
  'overview' | 'authority' | 'projections' | 'stories' | 'graph' | 'governance';

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
  readonly candidateSha: string;
  readonly promotionStatus: CandidatePromotionStatusDto | null;
  readonly validationRuns: readonly ValidationRunRecordDto[];
  readonly governanceApprovals: readonly CandidateApprovalRecordDto[];
  readonly isLoadingGovernance: boolean;
  readonly governanceError: string | null;
  readonly stalenessReport: BaselineExportStalenessReportDto | null;
  readonly isLoadingStaleness: boolean;
  readonly stalenessError: string | null;
  readonly selectedProvider?: string;
  readonly selectedContainer?: string;
  readonly setSelectedProvider: (provider?: string) => void;
  readonly setSelectedContainer: (container?: string) => void;
  readonly setCandidateSha: (sha: string) => void;
  readonly selectBaseline: (baselineId: string) => void;
  readonly setActiveTab: (tab: HandoffTab) => void;
  readonly selectStory: (storyId: string | null) => void;
  readonly refresh: () => Promise<void>;
  readonly refreshGovernance: () => Promise<void>;
  readonly refreshStaleness: () => Promise<void>;
  readonly approveCandidate: (decision: 'GO' | 'DESIGN_CHANGE', rationale: string) => Promise<void>;
  readonly revokeApproval: (approvalId: string, rationale: string) => Promise<void>;
  readonly exportAudit: () => Promise<void>;
  readonly exportStories: (request: ExportBacklogRequestDto) => Promise<ExportBacklogResponseDto>;
  readonly mutateStoryDependencies: (
    storyId: string,
    dependencies: string[]
  ) => Promise<StoryDto | undefined>;
  readonly clearMutationError: () => void;
}

export function useHandoffState(
  initialBaselineId?: string,
  initialCandidateSha?: string
): UseHandoffStateReturn {
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

  // Governance state
  const [candidateSha, setCandidateSha] = useState<string>(initialCandidateSha ?? '');
  const [promotionStatus, setPromotionStatus] = useState<CandidatePromotionStatusDto | null>(null);
  const [validationRuns, setValidationRuns] = useState<ValidationRunRecordDto[]>([]);
  const [governanceApprovals, setGovernanceApprovals] = useState<CandidateApprovalRecordDto[]>([]);
  const [isLoadingGovernance, setIsLoadingGovernance] = useState(false);
  const [governanceError, setGovernanceError] = useState<string | null>(null);

  // Staleness state
  const [stalenessReport, setStalenessReport] = useState<BaselineExportStalenessReportDto | null>(
    null
  );
  const [isLoadingStaleness, setIsLoadingStaleness] = useState(false);
  const [stalenessError, setStalenessError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string | undefined>(undefined);
  const [selectedContainer, setSelectedContainer] = useState<string | undefined>(undefined);

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

  // Fetch staleness report whenever activeBaselineId changes
  const fetchStaleness = useCallback(
    async (baselineId: string, provider?: string, container?: string) => {
      setIsLoadingStaleness(true);
      setStalenessError(null);
      try {
        const options =
          provider || container
            ? {
                provider,
                targetContainer: container
              }
            : undefined;
        const data = options
          ? await getExportStaleness(baselineId, options)
          : await getExportStaleness(baselineId);
        if (activeBaselineIdRef.current === baselineId) {
          setStalenessReport(data);
        }
      } catch (err) {
        if (activeBaselineIdRef.current === baselineId) {
          const msg = err instanceof Error ? err.message : 'Failed to load export staleness report';
          setStalenessError(msg);
        }
      } finally {
        setIsLoadingStaleness(false);
      }
    },
    []
  );

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
      fetchStaleness(activeBaselineId, selectedProvider, selectedContainer);
    } else {
      setStalenessReport(null);
    }
  }, [activeBaselineId, selectedProvider, selectedContainer, fetchBundle, fetchStaleness]);

  // Load authoritative current candidate on mount if not explicitly supplied
  useEffect(() => {
    let cancelled = false;
    if (!initialCandidateSha) {
      getCurrentCandidateSha()
        .then((sha) => {
          if (!cancelled && sha) {
            setCandidateSha(sha);
          }
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [initialCandidateSha]);

  const fetchGovernance = useCallback(async (sha: string) => {
    if (!sha || sha.trim().length === 0) {
      setPromotionStatus(null);
      setValidationRuns([]);
      setGovernanceApprovals([]);
      setGovernanceError(null);
      return;
    }
    setIsLoadingGovernance(true);
    setGovernanceError(null);
    try {
      const [statusData, runsData, approvalsData] = await Promise.all([
        getCandidatePromotionStatus(sha),
        listValidationRuns(sha),
        listGovernanceApprovals(sha)
      ]);
      setPromotionStatus(statusData);
      setValidationRuns(runsData);
      setGovernanceApprovals(approvalsData);
    } catch (err) {
      setPromotionStatus(null);
      setValidationRuns([]);
      setGovernanceApprovals([]);
      setGovernanceError(err instanceof Error ? err.message : 'Failed to load governance state');
    } finally {
      setIsLoadingGovernance(false);
    }
  }, []);

  useEffect(() => {
    fetchGovernance(candidateSha);
  }, [candidateSha, fetchGovernance]);

  const refreshGovernance = useCallback(async () => {
    await fetchGovernance(candidateSha);
  }, [candidateSha, fetchGovernance]);

  const approveCandidate = useCallback(
    async (decision: 'GO' | 'DESIGN_CHANGE', rationale: string): Promise<void> => {
      if (!candidateSha || candidateSha.trim().length === 0) {
        throw new Error('Candidate commit SHA is required to record approval.');
      }
      const latestRun = promotionStatus?.validationRun ?? validationRuns[0];
      if (!latestRun) {
        throw new Error('No validation run found to bind candidate approval to.');
      }
      await createGovernanceApproval({
        candidateSha,
        validationRunId: latestRun.id,
        evidenceDigest: latestRun.evidenceDigest,
        decision,
        rationale
      });
      await fetchGovernance(candidateSha);
    },
    [candidateSha, promotionStatus, validationRuns, fetchGovernance]
  );

  const revokeApproval = useCallback(
    async (approvalId: string, rationale: string): Promise<void> => {
      await revokeGovernanceApproval(approvalId, rationale);
      await fetchGovernance(candidateSha);
    },
    [candidateSha, fetchGovernance]
  );

  const exportAudit = useCallback(async (): Promise<void> => {
    if (!candidateSha || candidateSha.trim().length === 0) {
      throw new Error('Candidate commit SHA is required to export audit.');
    }
    const pkg = await exportGovernanceAudit(candidateSha);
    if (typeof window !== 'undefined') {
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `governance-audit-${candidateSha.slice(0, 12)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }, [candidateSha]);

  const selectBaseline = useCallback((id: string) => {
    activeBaselineIdRef.current = id;
    setActiveBaselineId(id);
    setSelectedStoryId(null);
    setUpdateDependenciesError(null);
  }, []);

  const refreshStaleness = useCallback(async () => {
    const current = activeBaselineIdRef.current;
    if (current) {
      await fetchStaleness(current, selectedProvider, selectedContainer);
    }
  }, [fetchStaleness, selectedProvider, selectedContainer]);

  const exportStories = useCallback(
    async (request: ExportBacklogRequestDto): Promise<ExportBacklogResponseDto> => {
      const currentBaseline = activeBaselineIdRef.current;
      if (!currentBaseline) {
        throw new Error('Baseline is required to export backlog');
      }
      setIsLoadingStaleness(true);
      setStalenessError(null);
      try {
        const result = await exportBacklog(currentBaseline, request);
        await fetchStaleness(
          currentBaseline,
          request.provider ?? selectedProvider,
          request.targetContainer ?? selectedContainer
        );
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to export backlog';
        setStalenessError(msg);
        throw err;
      } finally {
        setIsLoadingStaleness(false);
      }
    },
    [fetchStaleness, selectedProvider, selectedContainer]
  );

  const refresh = useCallback(async () => {
    const current = activeBaselineIdRef.current;
    await Promise.all([
      current ? fetchBundle(current) : Promise.resolve(),
      current ? fetchStaleness(current, selectedProvider, selectedContainer) : Promise.resolve(),
      fetchGovernance(candidateSha)
    ]);
  }, [
    fetchBundle,
    fetchStaleness,
    fetchGovernance,
    candidateSha,
    selectedProvider,
    selectedContainer
  ]);

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

  const selectStory = useCallback((id: string | null) => {
    setSelectedStoryId(id);
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
    candidateSha,
    promotionStatus,
    validationRuns,
    governanceApprovals,
    isLoadingGovernance,
    governanceError,
    stalenessReport,
    isLoadingStaleness,
    stalenessError,
    selectedProvider,
    selectedContainer,
    setSelectedProvider,
    setSelectedContainer,
    setCandidateSha,
    selectBaseline,
    setActiveTab,
    selectStory,
    refresh,
    refreshGovernance,
    refreshStaleness,
    approveCandidate,
    revokeApproval,
    exportAudit,
    exportStories,
    mutateStoryDependencies,
    clearMutationError
  };
}
