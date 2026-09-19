import { useEffect, useReducer, useMemo, useCallback } from 'react';
import type {
  RequirementsReviewStateDto,
  RequirementRevisionDto,
  CandidateFindingDto,
  EvidenceExcerptDto,
  ReconciliationRecordDto,
  ProjectionRecordDto
} from '@solutions-studio/contracts';
import type { ApiError } from '../api/client';
import { getReviewState } from '../api/reviewStateApi';
import { generateProjection } from '../api/projectionsApi';
import { createBaseline } from '../api/baselinesApi';
import {
  buildRevisionRequirementIndex,
  type RevisionRequirementIndex
} from '../lineage/revisionRequirementIndex';

export interface ReviewState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data?: RequirementsReviewStateDto;
  error?: ApiError | null;
  mutationError?: ApiError | null;
  selectedBaselineId?: string;
  availableBaselines?: readonly string[];
  isCreatingBaseline?: boolean;
  selectedRequirementId?: string;
  selectedFindingId?: string;
  selectedProjectionId?: string;
  findingsView: 'byRequirement' | 'all' | 'projections';
}

export type ReviewAction =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; payload: RequirementsReviewStateDto }
  | { type: 'FETCH_ERROR'; payload: ApiError }
  | { type: 'SELECT_BASELINE'; payload: string }
  | { type: 'SET_CREATING_BASELINE'; payload: boolean }
  | { type: 'SELECT_REQUIREMENT'; payload: string }
  | { type: 'SELECT_FINDING'; payload?: string }
  | { type: 'SELECT_PROJECTION'; payload: string }
  | { type: 'SET_FINDINGS_VIEW'; payload: 'byRequirement' | 'all' | 'projections' }
  | { type: 'MUTATION_SUCCESS_REQUIREMENT'; payload: RequirementRevisionDto }
  | { type: 'MUTATION_SUCCESS_FINDING'; payload: CandidateFindingDto }
  | { type: 'PROJECTION_GENERATED'; payload: ProjectionRecordDto }
  | { type: 'MUTATION_ERROR'; payload: ApiError }
  | { type: 'CLEAR_MUTATION_ERROR' };

export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case 'FETCH_START':
      return {
        ...state,
        status: state.data ? state.status : 'loading',
        error: null
      };

    case 'FETCH_SUCCESS': {
      const data = action.payload;
      const currentSelected = state.selectedRequirementId;
      const exists = data.requirementRevisions.some((r) => r.requirementId === currentSelected);
      const selectedRequirementId = exists
        ? currentSelected
        : data.requirementRevisions[0]?.requirementId;

      const combinedProjections = [...(data.projections ?? [])];
      if (state.data?.projections && state.data.baseline?.id === data.baseline?.id) {
        for (const p of state.data.projections) {
          if (
            p.baselineId === data.baseline?.id &&
            !combinedProjections.some((cp) => cp.id === p.id)
          ) {
            combinedProjections.push(p);
          }
        }
      }

      const currentSelectedProj = state.selectedProjectionId;
      const projExists = combinedProjections.some((p) => p.id === currentSelectedProj);
      const selectedProjectionId = projExists ? currentSelectedProj : combinedProjections[0]?.id;

      const availableBaselines = data.availableBaselines ?? state.availableBaselines ?? [];
      const selectedBaselineId = state.selectedBaselineId ?? data.baseline?.id;

      return {
        ...state,
        status: 'ready',
        data: {
          ...data,
          projections: combinedProjections
        },
        availableBaselines,
        selectedBaselineId,
        error: null,
        mutationError: null,
        selectedRequirementId,
        selectedProjectionId
      };
    }

    case 'FETCH_ERROR':
      return {
        ...state,
        status: 'error',
        error: action.payload
      };

    case 'SELECT_BASELINE':
      return {
        ...state,
        selectedBaselineId: action.payload,
        selectedRequirementId: undefined,
        selectedProjectionId: undefined,
        selectedFindingId: undefined,
        mutationError: null
      };

    case 'SET_CREATING_BASELINE':
      return {
        ...state,
        isCreatingBaseline: action.payload
      };

    case 'SELECT_REQUIREMENT':
      return {
        ...state,
        selectedRequirementId: action.payload,
        mutationError: null
      };

    case 'SELECT_FINDING':
      return {
        ...state,
        selectedFindingId: action.payload,
        mutationError: null
      };

    case 'SELECT_PROJECTION':
      return {
        ...state,
        selectedProjectionId: action.payload,
        mutationError: null
      };

    case 'SET_FINDINGS_VIEW':
      return {
        ...state,
        findingsView: action.payload
      };

    case 'PROJECTION_GENERATED': {
      if (!state.data) return state;
      const newProj = action.payload;
      const nextProjections = [...state.data.projections];
      const existingIdx = nextProjections.findIndex((p) => p.id === newProj.id);
      if (existingIdx >= 0) {
        nextProjections[existingIdx] = newProj;
      } else {
        nextProjections.push(newProj);
      }

      return {
        ...state,
        data: {
          ...state.data,
          projections: nextProjections
        },
        selectedProjectionId: newProj.id,
        mutationError: null
      };
    }

    case 'MUTATION_SUCCESS_REQUIREMENT': {
      if (!state.data) return state;
      const successor = action.payload;
      const nextRevisions = state.data.requirementRevisions.map((r) =>
        r.requirementId === successor.requirementId ? successor : r
      );
      if (!nextRevisions.some((r) => r.requirementId === successor.requirementId)) {
        nextRevisions.push(successor);
      }

      return {
        ...state,
        data: {
          ...state.data,
          requirementRevisions: nextRevisions
        },
        selectedRequirementId: successor.requirementId,
        mutationError: null
      };
    }

    case 'MUTATION_SUCCESS_FINDING': {
      if (!state.data) return state;
      const updated = action.payload;
      const nextFindings = state.data.findings.map((f) => (f.id === updated.id ? updated : f));
      if (!nextFindings.some((f) => f.id === updated.id)) {
        nextFindings.push(updated);
      }

      return {
        ...state,
        data: {
          ...state.data,
          findings: nextFindings
        },
        selectedFindingId: updated.id,
        mutationError: null
      };
    }

    case 'MUTATION_ERROR':
      return {
        ...state,
        mutationError: action.payload
      };

    case 'CLEAR_MUTATION_ERROR':
      return {
        ...state,
        mutationError: null
      };

    default:
      return state;
  }
}

export function useReviewState(baselineId?: string) {
  const [state, dispatch] = useReducer(reviewReducer, {
    status: 'idle',
    findingsView: 'byRequirement',
    selectedBaselineId: baselineId,
    availableBaselines: [],
    isCreatingBaseline: false
  });

  useEffect(() => {
    if (baselineId && baselineId !== state.selectedBaselineId) {
      dispatch({ type: 'SELECT_BASELINE', payload: baselineId });
    }
  }, [baselineId]);

  const activeBaselineId = state.selectedBaselineId ?? baselineId;

  const loadData = useCallback(async () => {
    dispatch({ type: 'FETCH_START' });
    try {
      const data = await getReviewState(activeBaselineId);
      dispatch({ type: 'FETCH_SUCCESS', payload: data });
    } catch (err) {
      dispatch({ type: 'FETCH_ERROR', payload: err as ApiError });
    }
  }, [activeBaselineId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const revisionRequirementIndex: RevisionRequirementIndex = useMemo(() => {
    if (!state.data) {
      return {
        revisionToRequirementId: new Map(),
        findingsByRequirementId: new Map(),
        unresolvedFindings: []
      };
    }
    return buildRevisionRequirementIndex(state.data);
  }, [state.data]);

  const evidenceByKey: ReadonlyMap<string, EvidenceExcerptDto> = useMemo(() => {
    const map = new Map<string, EvidenceExcerptDto>();
    if (!state.data) return map;
    for (const excerpt of state.data.evidenceExcerpts) {
      map.set(`${excerpt.sourceRevisionId}::${excerpt.locator}`, excerpt);
    }
    return map;
  }, [state.data]);

  const historyByEntityId: ReadonlyMap<string, readonly ReconciliationRecordDto[]> = useMemo(() => {
    const map = new Map<string, ReconciliationRecordDto[]>();
    if (!state.data) return map;
    for (const record of state.data.reconciliationHistory) {
      let list = map.get(record.entityId);
      if (!list) {
        list = [];
        map.set(record.entityId, list);
      }
      list.push(record);
    }
    return map;
  }, [state.data]);

  const selectedRequirement: RequirementRevisionDto | undefined = useMemo(() => {
    if (!state.data || !state.selectedRequirementId) return undefined;
    return state.data.requirementRevisions.find(
      (r) => r.requirementId === state.selectedRequirementId
    );
  }, [state.data, state.selectedRequirementId]);

  const selectedProjection: ProjectionRecordDto | undefined = useMemo(() => {
    if (!state.data) return undefined;
    return (
      state.data.projections.find((p) => p.id === state.selectedProjectionId) ??
      state.data.projections[0]
    );
  }, [state.data, state.selectedProjectionId]);

  const findingsForSelectedRequirement: readonly CandidateFindingDto[] = useMemo(() => {
    if (!state.selectedRequirementId) return [];
    return revisionRequirementIndex.findingsByRequirementId.get(state.selectedRequirementId) ?? [];
  }, [revisionRequirementIndex, state.selectedRequirementId]);

  const selectBaseline = useCallback((newBaselineId: string) => {
    dispatch({ type: 'SELECT_BASELINE', payload: newBaselineId });
  }, []);

  const openCreateBaselineModal = useCallback(() => {
    dispatch({ type: 'SET_CREATING_BASELINE', payload: true });
  }, []);

  const closeCreateBaselineModal = useCallback(() => {
    dispatch({ type: 'SET_CREATING_BASELINE', payload: false });
  }, []);

  const handleCreateBaseline = useCallback(
    async (params: { id?: string; requirementRevisions: string[]; createdBy: string }) => {
      try {
        const newBaseline = await createBaseline(params);
        dispatch({ type: 'SELECT_BASELINE', payload: newBaseline.id });
        dispatch({ type: 'SET_CREATING_BASELINE', payload: false });
        const fresh = await getReviewState(newBaseline.id);
        dispatch({ type: 'FETCH_SUCCESS', payload: fresh });
      } catch (err) {
        dispatch({ type: 'MUTATION_ERROR', payload: err as ApiError });
        throw err;
      }
    },
    []
  );

  const selectRequirement = useCallback((requirementId: string) => {
    dispatch({ type: 'SELECT_REQUIREMENT', payload: requirementId });
  }, []);

  const selectFinding = useCallback((findingId?: string) => {
    dispatch({ type: 'SELECT_FINDING', payload: findingId });
  }, []);

  const selectProjection = useCallback((projectionId: string) => {
    dispatch({ type: 'SELECT_PROJECTION', payload: projectionId });
  }, []);

  const setFindingsView = useCallback((view: 'byRequirement' | 'all' | 'projections') => {
    dispatch({ type: 'SET_FINDINGS_VIEW', payload: view });
  }, []);

  const clearMutationError = useCallback(() => {
    dispatch({ type: 'CLEAR_MUTATION_ERROR' });
  }, []);

  const handleGenerateProjection = useCallback(
    async (
      artifactType: 'process-diagram' | 'state-diagram' | 'prototype',
      prompt?: string
    ): Promise<ProjectionRecordDto> => {
      if (!activeBaselineId) {
        throw new Error('Cannot generate projection without an active baseline');
      }
      try {
        const projection = await generateProjection(activeBaselineId, { artifactType, prompt });
        dispatch({ type: 'PROJECTION_GENERATED', payload: projection });
        getReviewState(activeBaselineId)
          .then((fresh) => dispatch({ type: 'FETCH_SUCCESS', payload: fresh }))
          .catch(() => {});
        return projection;
      } catch (err) {
        dispatch({ type: 'MUTATION_ERROR', payload: err as ApiError });
        throw err;
      }
    },
    [activeBaselineId]
  );

  const handleRequirementMutation = useCallback(
    async (mutationFn: () => Promise<RequirementRevisionDto>): Promise<RequirementRevisionDto> => {
      try {
        const successor = await mutationFn();
        dispatch({ type: 'MUTATION_SUCCESS_REQUIREMENT', payload: successor });
        // Background refresh to update evidence, history, and lineage
        getReviewState(activeBaselineId)
          .then((fresh) => dispatch({ type: 'FETCH_SUCCESS', payload: fresh }))
          .catch(() => {});
        return successor;
      } catch (err) {
        dispatch({ type: 'MUTATION_ERROR', payload: err as ApiError });
        throw err;
      }
    },
    [activeBaselineId]
  );

  const handleFindingMutation = useCallback(
    async (mutationFn: () => Promise<CandidateFindingDto>): Promise<CandidateFindingDto> => {
      try {
        const updated = await mutationFn();
        dispatch({ type: 'MUTATION_SUCCESS_FINDING', payload: updated });
        // Background refresh to update history
        getReviewState(activeBaselineId)
          .then((fresh) => dispatch({ type: 'FETCH_SUCCESS', payload: fresh }))
          .catch(() => {});
        return updated;
      } catch (err) {
        dispatch({ type: 'MUTATION_ERROR', payload: err as ApiError });
        throw err;
      }
    },
    [activeBaselineId]
  );

  return {
    status: state.status,
    data: state.data,
    error: state.error,
    mutationError: state.mutationError,
    activeBaselineId,
    selectedBaselineId: state.selectedBaselineId,
    availableBaselines: state.availableBaselines,
    isCreatingBaseline: state.isCreatingBaseline,
    selectedRequirementId: state.selectedRequirementId,
    selectedFindingId: state.selectedFindingId,
    selectedProjectionId: state.selectedProjectionId,
    selectedRequirement,
    selectedProjection,
    projections: state.data?.projections ?? [],
    findingsView: state.findingsView,
    findingsForSelectedRequirement,
    revisionRequirementIndex,
    evidenceByKey,
    historyByEntityId,
    refresh: loadData,
    selectBaseline,
    openCreateBaselineModal,
    closeCreateBaselineModal,
    handleCreateBaseline,
    selectRequirement,
    selectFinding,
    selectProjection,
    setFindingsView,
    clearMutationError,
    handleRequirementMutation,
    handleFindingMutation,
    handleGenerateProjection
  };
}
