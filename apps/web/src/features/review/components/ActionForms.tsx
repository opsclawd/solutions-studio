'use client';

import React, { useState } from 'react';
import type {
  RequirementRevisionDto,
  RequirementCategoryDto,
  RequirementOriginDto
} from '@solutions-studio/contracts';
import { REQUIREMENT_CATEGORIES, REQUIREMENT_ORIGINS } from '@solutions-studio/domain';

export interface ActionFormsProps {
  revision: RequirementRevisionDto;
  actorId?: string;
  onAccept: (rationale: string) => Promise<void>;
  onReject: (rationale: string) => Promise<void>;
  onResolve: (rationale: string) => Promise<void>;
  onRevise: (changes: {
    statement?: string;
    category?: RequirementCategoryDto;
    origin?: RequirementOriginDto;
    rationale: string;
    affectedActors?: string[];
    dependencies?: string[];
  }) => Promise<void>;
}

type ActiveAction = 'accept' | 'reject' | 'resolve' | 'revise' | null;

export function ActionForms({
  revision,
  actorId: _actorId,
  onAccept,
  onReject,
  onResolve,
  onRevise
}: ActionFormsProps) {
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [rationale, setRationale] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Revise-specific fields
  const [draftStatement, setDraftStatement] = useState(revision.statement);
  const [draftCategory, setDraftCategory] = useState<RequirementCategoryDto>(revision.category);
  const [draftOrigin, setDraftOrigin] = useState<RequirementOriginDto>(revision.origin);
  const [draftActors, setDraftActors] = useState(revision.affectedActors?.join(', ') || '');
  const [draftDeps, setDraftDeps] = useState(revision.dependencies?.join(', ') || '');

  const openAction = (action: ActiveAction) => {
    setActiveAction(action);
    setRationale('');
    setLocalError(null);
    if (action === 'revise') {
      setDraftStatement(revision.statement);
      setDraftCategory(revision.category);
      setDraftOrigin(revision.origin);
      setDraftActors(revision.affectedActors?.join(', ') || '');
      setDraftDeps(revision.dependencies?.join(', ') || '');
    }
  };

  const closeAction = () => {
    setActiveAction(null);
    setRationale('');
    setLocalError(null);
  };

  const handleExecute = async () => {
    if (!rationale.trim()) return;
    setIsSubmitting(true);
    setLocalError(null);

    try {
      if (activeAction === 'accept') {
        await onAccept(rationale.trim());
      } else if (activeAction === 'reject') {
        await onReject(rationale.trim());
      } else if (activeAction === 'resolve') {
        await onResolve(rationale.trim());
      } else if (activeAction === 'revise') {
        const affectedActors = draftActors
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const dependencies = draftDeps
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

        await onRevise({
          statement: draftStatement.trim() || undefined,
          category: draftCategory,
          origin: draftOrigin,
          rationale: rationale.trim(),
          affectedActors: affectedActors.length > 0 ? affectedActors : undefined,
          dependencies: dependencies.length > 0 ? dependencies : undefined
        });
      }
      closeAction();
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : 'Operation failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const canAccept = revision.reviewState === 'PENDING';
  const canReject = revision.reviewState === 'PENDING';
  const canResolve = revision.resolutionState !== 'CLEAR';

  return (
    <div data-testid="action-forms-container" className="space-y-4">
      {/* Primary Action Button Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="open-accept-form-btn"
          disabled={!canAccept}
          onClick={() => openAction('accept')}
          className={`px-3 py-1.5 rounded text-xs font-semibold transition ${
            activeAction === 'accept'
              ? 'bg-emerald-700 text-white ring-2 ring-emerald-400'
              : canAccept
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
          }`}
        >
          Accept
        </button>

        <button
          type="button"
          data-testid="open-reject-form-btn"
          disabled={!canReject}
          onClick={() => openAction('reject')}
          className={`px-3 py-1.5 rounded text-xs font-semibold transition ${
            activeAction === 'reject'
              ? 'bg-rose-700 text-white ring-2 ring-rose-400'
              : canReject
                ? 'bg-rose-600 hover:bg-rose-700 text-white'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
          }`}
        >
          Reject
        </button>

        <button
          type="button"
          data-testid="open-resolve-form-btn"
          disabled={!canResolve}
          onClick={() => openAction('resolve')}
          className={`px-3 py-1.5 rounded text-xs font-semibold transition ${
            activeAction === 'resolve'
              ? 'bg-teal-700 text-white ring-2 ring-teal-400'
              : canResolve
                ? 'bg-teal-600 hover:bg-teal-700 text-white'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
          }`}
        >
          Resolve Conflict
        </button>

        <button
          type="button"
          data-testid="open-revise-form-btn"
          onClick={() => openAction('revise')}
          className={`px-3 py-1.5 rounded text-xs font-semibold transition ${
            activeAction === 'revise'
              ? 'bg-blue-700 text-white ring-2 ring-blue-400'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          Revise Requirement
        </button>
      </div>

      {/* Active Form Modal / Drawer */}
      {activeAction && (
        <div
          data-testid={`action-form-${activeAction}`}
          className="bg-gray-50 border border-gray-300 rounded-xl p-4 shadow-sm space-y-3"
        >
          <div className="flex items-center justify-between pb-2 border-b border-gray-200">
            <h4 className="font-bold text-gray-800 text-sm capitalize">
              {activeAction === 'resolve'
                ? 'Resolve Requirement Conflict'
                : `${activeAction} Requirement`}
            </h4>
            <button
              type="button"
              onClick={closeAction}
              className="text-gray-400 hover:text-gray-600 text-sm font-bold"
            >
              ✕
            </button>
          </div>

          {localError && (
            <div className="text-rose-700 bg-rose-50 p-2.5 rounded text-xs border border-rose-200">
              {localError}
            </div>
          )}

          {activeAction === 'revise' && (
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-gray-700 mb-1">
                  Requirement Statement:
                </label>
                <textarea
                  data-testid="revise-statement-input"
                  value={draftStatement}
                  onChange={(e) => setDraftStatement(e.target.value)}
                  rows={3}
                  className="w-full bg-white border border-gray-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500 font-normal"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-gray-700 mb-1">Category:</label>
                  <select
                    data-testid="revise-category-select"
                    value={draftCategory}
                    onChange={(e) => setDraftCategory(e.target.value as RequirementCategoryDto)}
                    className="w-full bg-white border border-gray-300 rounded px-2 py-1.5 focus:ring-1 focus:ring-blue-500"
                  >
                    {REQUIREMENT_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-gray-700 mb-1">Origin:</label>
                  <select
                    data-testid="revise-origin-select"
                    value={draftOrigin}
                    onChange={(e) => setDraftOrigin(e.target.value as RequirementOriginDto)}
                    className="w-full bg-white border border-gray-300 rounded px-2 py-1.5 focus:ring-1 focus:ring-blue-500"
                  >
                    {REQUIREMENT_ORIGINS.map((orig) => (
                      <option key={orig} value={orig}>
                        {orig}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-gray-700 mb-1">
                    Affected Actors (comma-separated):
                  </label>
                  <input
                    type="text"
                    data-testid="revise-actors-input"
                    value={draftActors}
                    onChange={(e) => setDraftActors(e.target.value)}
                    placeholder="e.g. admin, operator"
                    className="w-full bg-white border border-gray-300 rounded px-2 py-1.5"
                  />
                </div>

                <div>
                  <label className="block font-medium text-gray-700 mb-1">
                    Dependencies (comma-separated requirement IDs):
                  </label>
                  <input
                    type="text"
                    data-testid="revise-dependencies-input"
                    value={draftDeps}
                    onChange={(e) => setDraftDeps(e.target.value)}
                    placeholder="e.g. REQ-001, REQ-002"
                    className="w-full bg-white border border-gray-300 rounded px-2 py-1.5"
                  />
                </div>
              </div>

              <p className="text-[11px] text-amber-700 bg-amber-50 p-2 rounded">
                Note: Changing statement, category, origin, actors, or dependencies resets review
                state to PENDING and resolution state to UNRESOLVED per domain rules.
              </p>
            </div>
          )}

          <div>
            <label className="block font-medium text-gray-700 mb-1 text-xs">
              Reconciliation Rationale <span className="text-rose-500 font-bold">*</span>:
            </label>
            <textarea
              data-testid="action-rationale-input"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Detailed justification for this reconciliation decision..."
              rows={2}
              className="w-full bg-white border border-gray-300 rounded px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-200">
            <button
              type="button"
              onClick={closeAction}
              className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="submit-action-btn"
              disabled={!rationale.trim() || isSubmitting}
              onClick={handleExecute}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-xs font-semibold transition"
            >
              {isSubmitting ? 'Submitting...' : `Submit ${activeAction.toUpperCase()}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
