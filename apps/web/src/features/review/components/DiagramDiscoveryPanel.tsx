'use client';

import React, { useState } from 'react';
import type {
  ProjectionRecordDto,
  RequirementCategoryDto,
  FindingTypeDto
} from '@solutions-studio/contracts';
import { recordRequirementDiscovery, recordFindingDiscovery } from '../api/mutations';

export interface DiagramDiscoveryPanelProps {
  projection: ProjectionRecordDto;
  actorId?: string;
  onDiscoveryRecorded?: () => void | Promise<void>;
  onNavigateToRequirement?: (requirementId: string) => void;
  onNavigateToFinding?: (findingId: string) => void;
}

export function DiagramDiscoveryPanel({
  projection,
  actorId,
  onDiscoveryRecorded,
  onNavigateToRequirement,
  onNavigateToFinding
}: DiagramDiscoveryPanelProps) {
  const [activeTab, setActiveTab] = useState<'requirement' | 'finding'>('requirement');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastCreatedRequirementId, setLastCreatedRequirementId] = useState<string | null>(null);
  const [lastCreatedFindingId, setLastCreatedFindingId] = useState<string | null>(null);

  // Requirement proposal state
  const [statement, setStatement] = useState<string>('');
  const [category, setCategory] = useState<RequirementCategoryDto>('business-rule');
  const [reqRationale, setReqRationale] = useState<string>('');

  // Finding discovery state
  const [findingType, setFindingType] = useState<FindingTypeDto>('incomplete-state-machine');
  const [selectedRevs, setSelectedRevs] = useState<string[]>(
    projection.requirementRevisionIds.length > 0 ? [projection.requirementRevisionIds[0]] : []
  );
  const [findingRationale, setFindingRationale] = useState<string>('');

  const handleRevCheckboxToggle = (revId: string) => {
    setSelectedRevs((prev) =>
      prev.includes(revId) ? prev.filter((r) => r !== revId) : [...prev, revId]
    );
  };

  const handleSubmitRequirement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statement.trim() || !reqRationale.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setSuccessMessage(null);
    setErrorMessage(null);

    try {
      const created = await recordRequirementDiscovery({
        statement: statement.trim(),
        category,
        rationale: reqRationale.trim(),
        actorId: actorId || undefined,
        baselineId: projection.baselineId,
        originatingProjectionId: projection.id
      });

      setLastCreatedRequirementId(created.requirementId);
      setSuccessMessage('Requirement proposal recorded successfully.');
      setStatement('');
      setReqRationale('');
      if (onDiscoveryRecorded) {
        await onDiscoveryRecorded();
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to record requirement proposal');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitFinding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!findingRationale.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setSuccessMessage(null);
    setErrorMessage(null);

    try {
      const created = await recordFindingDiscovery({
        type: findingType,
        discoveredBy: 'artifact-validation',
        rationale: findingRationale.trim(),
        actorId: actorId || undefined,
        baselineId: projection.baselineId,
        originatingProjectionId: projection.id,
        affectedRequirementRevisions: selectedRevs
      });

      setLastCreatedFindingId(created.id);
      setSuccessMessage('Candidate finding recorded successfully.');
      setFindingRationale('');
      if (onDiscoveryRecorded) {
        await onDiscoveryRecorded();
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to record candidate finding');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      data-testid="diagram-discovery-panel"
      className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-xs mt-6 p-6"
    >
      <div className="mb-4">
        <h3 className="text-sm font-bold text-gray-900">Report Diagram Discovery</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Propose requirements or report findings discovered during diagram inspection without
          mutating baseline{' '}
          <span className="font-mono font-semibold text-gray-700">{projection.baselineId}</span>.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-5">
        <button
          type="button"
          data-testid="discovery-tab-requirement"
          onClick={() => {
            setActiveTab('requirement');
            setSuccessMessage(null);
            setErrorMessage(null);
          }}
          className={`px-4 py-2 text-xs font-semibold border-b-2 transition ${
            activeTab === 'requirement'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Propose Requirement
        </button>
        <button
          type="button"
          data-testid="discovery-tab-finding"
          onClick={() => {
            setActiveTab('finding');
            setSuccessMessage(null);
            setErrorMessage(null);
          }}
          className={`px-4 py-2 text-xs font-semibold border-b-2 transition ${
            activeTab === 'finding'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Report Finding
        </button>
      </div>

      {/* Feedback Messages */}
      {successMessage && (
        <div
          data-testid="discovery-success-message"
          className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-xs flex flex-wrap items-center justify-between gap-2"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span>✓ {successMessage}</span>
            {lastCreatedRequirementId && activeTab === 'requirement' && (
              <button
                type="button"
                data-testid="view-discovered-requirement-btn"
                onClick={() => onNavigateToRequirement?.(lastCreatedRequirementId)}
                className="font-semibold underline text-green-900 hover:text-green-950"
              >
                Review &amp; Reconcile Requirement {lastCreatedRequirementId} →
              </button>
            )}
            {lastCreatedFindingId && activeTab === 'finding' && (
              <button
                type="button"
                data-testid="view-discovered-finding-btn"
                onClick={() => onNavigateToFinding?.(lastCreatedFindingId)}
                className="font-semibold underline text-green-900 hover:text-green-950"
              >
                View Finding {lastCreatedFindingId} in Workspace →
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="text-green-600 hover:text-green-800 font-bold ml-3"
          >
            ✕
          </button>
        </div>
      )}

      {errorMessage && (
        <div
          data-testid="discovery-error-message"
          className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-xs flex items-center justify-between"
        >
          <span>✕ {errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-red-600 hover:text-red-800 font-bold ml-3"
          >
            ✕
          </button>
        </div>
      )}

      {/* Requirement Discovery Form */}
      {activeTab === 'requirement' && (
        <form onSubmit={handleSubmitRequirement} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Proposed Requirement Statement <span className="text-red-500">*</span>
            </label>
            <textarea
              data-testid="discovery-statement-input"
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              placeholder="e.g. System must log all administrative RBAC assignments to audit vault"
              rows={2}
              className="w-full text-xs p-2.5 border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-hidden font-normal"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Requirement Category
              </label>
              <select
                data-testid="discovery-category-select"
                value={category}
                onChange={(e) => setCategory(e.target.value as RequirementCategoryDto)}
                className="w-full text-xs p-2.5 bg-white border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-hidden"
              >
                <option value="business-rule">Business Rule</option>
                <option value="actors-permissions">Actors &amp; Permissions</option>
                <option value="data-constraint">Data Constraint</option>
                <option value="system-interface">System Interface</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Rationale / Justification <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                data-testid="discovery-rationale-input"
                value={reqRationale}
                onChange={(e) => setReqRationale(e.target.value)}
                placeholder="e.g. Discovered missing audit trail during diagram review"
                className="w-full text-xs p-2.5 border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-hidden"
                required
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              data-testid="submit-requirement-discovery-btn"
              disabled={!statement.trim() || !reqRationale.trim() || isSubmitting}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition shadow-xs"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Requirement Proposal'}
            </button>
          </div>
        </form>
      )}

      {/* Finding Discovery Form */}
      {activeTab === 'finding' && (
        <form onSubmit={handleSubmitFinding} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Finding Type</label>
            <select
              data-testid="discovery-finding-type-select"
              value={findingType}
              onChange={(e) => setFindingType(e.target.value as FindingTypeDto)}
              className="w-full text-xs p-2.5 bg-white border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-hidden"
            >
              <option value="incomplete-state-machine">Incomplete State Machine</option>
              <option value="missing-authorization">Missing Authorization</option>
              <option value="contradiction">Contradiction</option>
              <option value="missing-failure-recovery">Missing Failure Recovery</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              Affected Baseline Revisions
            </label>
            <div className="flex flex-wrap gap-3">
              {projection.requirementRevisionIds.map((revId) => (
                <label
                  key={revId}
                  className="flex items-center gap-1.5 text-xs text-gray-700 font-mono"
                >
                  <input
                    type="checkbox"
                    data-testid={`discovery-affected-rev-${revId}`}
                    checked={selectedRevs.includes(revId)}
                    onChange={() => handleRevCheckboxToggle(revId)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>{revId}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Rationale / Description <span className="text-red-500">*</span>
            </label>
            <textarea
              data-testid="discovery-finding-rationale-input"
              value={findingRationale}
              onChange={(e) => setFindingRationale(e.target.value)}
              placeholder="e.g. State transition for session timeout is missing rollback"
              rows={2}
              className="w-full text-xs p-2.5 border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-hidden font-normal"
              required
            />
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              data-testid="submit-finding-discovery-btn"
              disabled={!findingRationale.trim() || isSubmitting}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition shadow-xs"
            >
              {isSubmitting ? 'Submitting...' : 'Report Candidate Finding'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
