'use client';

import React from 'react';
import type { ApiError } from '../api/client';

export interface ErrorBannerProps {
  error: ApiError;
  onDismiss?: () => void;
  onReload?: () => void;
}

export function ErrorBanner({ error, onDismiss, onReload }: ErrorBannerProps) {
  const isStale = error.code === 'STALE_REVISION_TARGET';
  const isBlocked = error.code === 'BLOCKED_BY_OPEN_FINDINGS';
  const isForbidden = error.code === 'FORBIDDEN';
  const isUnauthenticated = error.code === 'UNAUTHENTICATED';
  const details = error.details as Record<string, unknown> | undefined;

  return (
    <div
      data-testid="review-error-banner"
      className="bg-rose-50 border-l-4 border-rose-500 p-4 mb-4 rounded-r shadow-sm text-sm text-rose-800"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span
              data-testid="error-code-badge"
              className="px-2 py-0.5 rounded bg-rose-200 text-rose-900 text-xs font-mono font-bold"
            >
              {error.code}
            </span>
            <span className="font-semibold text-rose-900">
              {isStale
                ? 'Stale Revision Conflict'
                : isBlocked
                  ? 'Blocked by Open Findings'
                  : isForbidden
                    ? 'Access Denied (Insufficient Permissions)'
                    : isUnauthenticated
                      ? 'Authentication Required'
                      : 'Action Failed'}
            </span>
          </div>

          <p data-testid="error-message-text" className="text-rose-700">
            {isStale && details?.latestRevisionId
              ? `This requirement was modified by another action (latest revision is ${String(details.latestRevisionId)}). Reload to review and act on the newest revision.`
              : error.message}
          </p>

          {isBlocked && Array.isArray(details?.blockingFindings) && (
            <ul className="mt-2 list-disc list-inside text-xs text-rose-600">
              {details.blockingFindings.map((b: unknown, idx: number) => {
                const item =
                  typeof b === 'object' && b !== null ? (b as Record<string, unknown>) : null;
                return (
                  <li key={idx} data-testid="blocking-finding-item">
                    {item
                      ? `${String(item.id || 'Finding')}: ${String(item.rationale || item.type || 'Open issue')}`
                      : String(b)}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-3 flex items-center gap-3">
            {isStale && onReload && (
              <button
                type="button"
                data-testid="reload-latest-btn"
                onClick={onReload}
                className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-medium transition"
              >
                Reload latest revision
              </button>
            )}
            {onDismiss && (
              <button
                type="button"
                data-testid="dismiss-error-btn"
                onClick={onDismiss}
                className="text-xs text-rose-700 hover:text-rose-900 underline font-medium"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
