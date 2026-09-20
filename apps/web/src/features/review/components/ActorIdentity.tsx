'use client';

import React, { useState, useEffect } from 'react';
import { PRESET_PERSONAS, setSelectedPersona, getSelectedPersona } from '../../auth/tokenStore';
import { useAuth } from '../../auth/AuthContext';

export interface ActorIdentityProps {
  actorId?: string;
  onActorChange?: (actor: string) => void;
}

export function ActorIdentity({ actorId, onActorChange }: ActorIdentityProps) {
  const auth = useAuth();
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('anonymous');

  const isTestMode = process.env.NEXT_PUBLIC_AUTH_MODE === 'test';

  useEffect(() => {
    const persona = getSelectedPersona();
    setSelectedPersonaId(persona);
  }, []);

  const handlePersonaSelect = async (newPersonaId: string) => {
    setSelectedPersonaId(newPersonaId);
    setSelectedPersona(newPersonaId);
    await auth.switchPersona(newPersonaId);
    if (onActorChange) {
      const persona = PRESET_PERSONAS.find((p) => p.id === newPersonaId);
      if (persona) {
        onActorChange(persona.actorId);
      }
    }
  };

  const currentPersona = PRESET_PERSONAS.find((p) => p.id === selectedPersonaId);
  const displayedIdentity = auth.actor?.id || auth.actor?.name || actorId || 'Unauthenticated';

  return (
    <div className="flex items-center gap-2 text-xs text-gray-600 bg-white px-3 py-1.5 rounded border border-gray-200 shadow-sm">
      <span className="font-medium text-gray-500">Principal:</span>

      {/* Test Persona Switcher: Only displayed in test mode */}
      {isTestMode && (
        <select
          data-testid="persona-select"
          value={selectedPersonaId}
          onChange={(e) => void handlePersonaSelect(e.target.value)}
          className="px-1.5 py-0.5 border border-gray-300 rounded text-xs bg-gray-50 hover:bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
          title="Switch test persona"
        >
          {PRESET_PERSONAS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      )}

      {/* Server-derived, tamper-proof actor identity display */}
      <div className="flex items-center gap-1.5">
        <span data-testid="actor-identity-display" className="font-semibold text-gray-800">
          {displayedIdentity}
        </span>
      </div>

      {auth.actor?.actorType && auth.actor.actorType !== 'human' && (
        <span
          data-testid="actor-type-badge"
          className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-amber-100 text-amber-800 border border-amber-200"
        >
          {auth.actor.actorType}
        </span>
      )}

      {currentPersona && currentPersona.role && (
        <span
          data-testid="actor-role-badge"
          className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-slate-100 text-slate-700 border border-slate-200"
        >
          {currentPersona.role}
        </span>
      )}

      {!isTestMode && !auth.actor && (
        <button
          type="button"
          onClick={() => void auth.login()}
          className="ml-2 px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium"
        >
          Log In
        </button>
      )}

      {!isTestMode && auth.actor && (
        <button
          type="button"
          onClick={() => auth.logout()}
          className="ml-2 px-2 py-0.5 text-gray-600 hover:text-gray-900 border border-gray-200 rounded text-xs"
        >
          Log Out
        </button>
      )}
    </div>
  );
}
