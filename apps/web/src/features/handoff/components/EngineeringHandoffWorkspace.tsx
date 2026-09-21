'use client';

import { useHandoffState } from '../state/useHandoffState';
import { HandoffHeader } from './HandoffHeader';
import { UnresolvedFindingsAlert } from './UnresolvedFindingsAlert';
import { AuthorityContractsSection } from './AuthorityContractsSection';
import { ProjectionsSection } from './ProjectionsSection';
import { StoryReadinessBacklogSection } from './StoryReadinessBacklogSection';
import { DependencyGraphSection } from './DependencyGraphSection';
import { GovernanceAuditSection } from './GovernanceAuditSection';

export interface EngineeringHandoffWorkspaceProps {
  readonly baselineId?: string;
  readonly candidateSha?: string;
}

export function EngineeringHandoffWorkspace({
  baselineId,
  candidateSha: initialCandidateSha
}: EngineeringHandoffWorkspaceProps) {
  const {
    status,
    error,
    bundle,
    activeBaselineId,
    availableBaselines,
    activeTab,
    isUpdatingDependencies,
    updateDependenciesError,
    candidateSha,
    promotionStatus,
    validationRuns,
    governanceApprovals,
    isLoadingGovernance,
    governanceError,
    stalenessReport,
    setCandidateSha,
    approveCandidate,
    revokeApproval,
    exportAudit,
    exportStories,
    refreshGovernance,
    selectBaseline,
    setActiveTab,
    refresh,
    mutateStoryDependencies
  } = useHandoffState(baselineId, initialCandidateSha);

  if (status === 'loading' && !bundle) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-medium text-gray-500">
            Loading engineering handoff workspace...
          </p>
        </div>
      </div>
    );
  }

  if (status === 'error' && !bundle) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">
        <div className="max-w-md w-full bg-white border border-red-200 rounded-xl p-6 shadow-xs text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900">Failed to Load Handoff Bundle</h2>
            <p className="text-xs text-gray-600 mt-1">{error}</p>
          </div>
          <button
            type="button"
            onClick={refresh}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 shadow-xs transition"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const handleUpdateDeps = async (storyId: string, dependencies: string[]) => {
    await mutateStoryDependencies(storyId, dependencies);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col text-gray-900">
      {/* Top Header */}
      <HandoffHeader
        bundle={bundle}
        activeBaselineId={activeBaselineId}
        availableBaselines={availableBaselines}
        candidateSha={candidateSha}
        onCandidateShaChange={setCandidateSha}
        promotionStatus={promotionStatus}
        stalenessReport={stalenessReport}
        onSelectBaseline={selectBaseline}
        onRefresh={refresh}
      />

      {/* Main Workspace Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        {/* Navigation Tabs */}
        <div className="flex bg-white p-1 rounded-xl border border-gray-200 shadow-2xs text-xs font-medium self-start">
          <button
            type="button"
            data-testid="nav-tab-overview"
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 rounded-lg transition ${
              activeTab === 'overview'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Overview
          </button>
          <button
            type="button"
            data-testid="nav-tab-authority"
            onClick={() => setActiveTab('authority')}
            className={`px-4 py-2 rounded-lg transition ${
              activeTab === 'authority'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Authority Contracts
          </button>
          <button
            type="button"
            data-testid="nav-tab-projections"
            onClick={() => setActiveTab('projections')}
            className={`px-4 py-2 rounded-lg transition ${
              activeTab === 'projections'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Projections
          </button>
          <button
            type="button"
            data-testid="nav-tab-stories"
            onClick={() => setActiveTab('stories')}
            className={`px-4 py-2 rounded-lg transition ${
              activeTab === 'stories'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Story Readiness ({bundle?.stories.length ?? 0})
          </button>
          <button
            type="button"
            data-testid="nav-tab-graph"
            onClick={() => setActiveTab('graph')}
            className={`px-4 py-2 rounded-lg transition ${
              activeTab === 'graph'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Dependency DAG
          </button>
          <button
            type="button"
            data-testid="nav-tab-governance"
            onClick={() => setActiveTab('governance')}
            className={`px-4 py-2 rounded-lg transition ${
              activeTab === 'governance'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Governance Audit
          </button>
        </div>

        {/* Governance Error Alert */}
        {governanceError && (
          <div
            data-testid="governance-error-alert"
            className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center justify-between shadow-2xs"
          >
            <div className="flex items-center gap-2">
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
              <span>
                <strong>Governance Error:</strong> {governanceError}
              </span>
            </div>
            <button
              type="button"
              onClick={refreshGovernance}
              className="text-xs underline font-medium hover:text-red-900 ml-4 shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        {/* Blocker Alert Banner */}
        {bundle && (
          <UnresolvedFindingsAlert
            baselineId={bundle.baseline.id}
            blockingFindings={bundle.blockingFindings}
            unresolvedRequirements={bundle.unresolvedRequirements}
            dependencyGraph={bundle.dependencyGraph}
            engineeringDecisions={bundle.engineeringDecisions}
          />
        )}

        {/* Tab Views */}
        {bundle && (
          <div className="space-y-6">
            {(activeTab === 'overview' || activeTab === 'graph') && (
              <DependencyGraphSection graph={bundle.dependencyGraph} />
            )}

            {(activeTab === 'overview' || activeTab === 'stories') && (
              <StoryReadinessBacklogSection
                stories={bundle.stories}
                readinessReports={bundle.readinessReports}
                coverage={bundle.coverage}
                stalenessReport={stalenessReport}
                onUpdateDependencies={handleUpdateDeps}
                onExportBacklog={exportStories}
                isUpdatingDependencies={isUpdatingDependencies}
                mutationError={updateDependenciesError}
              />
            )}

            {(activeTab === 'overview' || activeTab === 'authority') && (
              <AuthorityContractsSection
                baselineId={bundle.baseline.id}
                authorityBundle={bundle.authorityBundle}
                engineeringDecisions={bundle.engineeringDecisions}
              />
            )}

            {(activeTab === 'overview' || activeTab === 'projections') && (
              <ProjectionsSection
                sqlProjection={bundle.sqlProjection}
                openApiProjection={bundle.openApiProjection}
                stories={bundle.stories}
              />
            )}

            {(activeTab === 'overview' || activeTab === 'governance') && (
              <GovernanceAuditSection
                candidateSha={candidateSha}
                promotionStatus={promotionStatus}
                validationRuns={validationRuns}
                approvals={governanceApprovals}
                isLoading={isLoadingGovernance}
                error={governanceError}
                onCandidateShaChange={setCandidateSha}
                onApprove={approveCandidate}
                onRevoke={revokeApproval}
                onExportAudit={exportAudit}
                onRefresh={refreshGovernance}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
