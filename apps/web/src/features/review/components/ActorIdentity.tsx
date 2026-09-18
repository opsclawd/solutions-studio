'use client';

import React, { useState, useEffect } from 'react';

export const ACTOR_STORAGE_KEY = 'solutions-studio-actor-id';

export interface ActorIdentityProps {
  actorId: string;
  onActorChange: (actor: string) => void;
}

export function ActorIdentity({ actorId, onActorChange }: ActorIdentityProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(actorId);

  useEffect(() => {
    setDraft(actorId);
  }, [actorId]);

  const handleSave = () => {
    const trimmed = draft.trim();
    onActorChange(trimmed);
    if (typeof window !== 'undefined') {
      if (trimmed) {
        localStorage.setItem(ACTOR_STORAGE_KEY, trimmed);
      } else {
        localStorage.removeItem(ACTOR_STORAGE_KEY);
      }
    }
    setIsEditing(false);
  };

  return (
    <div className="flex items-center gap-2 text-xs text-gray-600 bg-white px-3 py-1.5 rounded border border-gray-200 shadow-sm">
      <span className="font-medium text-gray-500">Reviewer:</span>
      {isEditing ? (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            data-testid="actor-identity-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. jane.reviewer"
            className="px-2 py-0.5 border border-blue-400 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') {
                setDraft(actorId);
                setIsEditing(false);
              }
            }}
          />
          <button
            type="button"
            data-testid="actor-identity-save-btn"
            onClick={handleSave}
            className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded hover:bg-blue-700"
          >
            Save
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <span data-testid="actor-identity-display" className="font-semibold text-gray-800">
            {actorId || 'Anonymous'}
          </span>
          <button
            type="button"
            data-testid="actor-identity-edit-btn"
            onClick={() => setIsEditing(true)}
            className="text-blue-600 hover:text-blue-800 underline text-xs"
          >
            Change
          </button>
        </div>
      )}
    </div>
  );
}
