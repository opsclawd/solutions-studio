'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { AuthenticatedActorDto, ApplicationCapabilityDto } from '@solutions-studio/contracts';
import {
  PRESET_PERSONAS,
  type PersonaDefinition,
  getAuthToken,
  setAuthToken,
  getSelectedPersona,
  setSelectedPersona,
  resetAuthStore
} from './tokenStore';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateRandomString,
  savePkceState,
  getAndClearPkceState,
  buildAuthorizationUrl,
  exchangeCodeForToken
} from './pkce';
import { apiClient } from '../review/api/client';

export interface AuthContextValue {
  actor: AuthenticatedActorDto | null;
  token: string | null;
  personaId: string;
  personas: readonly PersonaDefinition[];
  isLoading: boolean;
  hasCapability: (capability: string) => boolean;
  switchPersona: (personaId: string) => Promise<void>;
  setCustomToken: (token: string) => Promise<void>;
  refreshActor: () => Promise<void>;
  login: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [personaId, setPersonaIdState] = useState<string>('anonymous');
  const [actor, setActor] = useState<AuthenticatedActorDto | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchActor = useCallback(async (currentToken: string | null) => {
    try {
      setIsLoading(true);
      const actorDto = await apiClient<AuthenticatedActorDto>('/api/auth/me', {
        headers: currentToken ? { Authorization: `Bearer ${currentToken}` } : undefined
      });
      setActor(actorDto);
    } catch {
      // Invariant: Fail closed on /api/auth/me failure — never fabricate actor identities!
      setActor(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Check for PKCE authorization code callback in URL parameters
    if (typeof window !== 'undefined' && window.location.search) {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const state = params.get('state');

      if (code && state) {
        const pkceState = getAndClearPkceState();
        if (pkceState && pkceState.state === state) {
          const issuer =
            process.env.NEXT_PUBLIC_OIDC_ISSUER || 'http://localhost:8080/realms/solutions-studio';
          const tokenEndpoint =
            process.env.NEXT_PUBLIC_OIDC_TOKEN_ENDPOINT ||
            `${issuer.replace(/\/$/, '')}/protocol/openid-connect/token`;
          const clientId = process.env.NEXT_PUBLIC_OIDC_CLIENT_ID || 'solutions-studio-web';
          const redirectUri = `${window.location.origin}${window.location.pathname}`;

          exchangeCodeForToken({
            tokenEndpoint,
            clientId,
            redirectUri,
            code,
            codeVerifier: pkceState.verifier
          })
            .then((tokens) => {
              setAuthToken(tokens.access_token);
              setTokenState(tokens.access_token);
              window.history.replaceState({}, document.title, window.location.pathname);
              return fetchActor(tokens.access_token);
            })
            .catch((err) => {
              console.error('OIDC PKCE token exchange failed:', err);
              setActor(null);
              setIsLoading(false);
            });
          return;
        }
      }
    }

    const initialPersona = getSelectedPersona();
    const initialToken = getAuthToken();
    setPersonaIdState(initialPersona);
    setTokenState(initialToken);
    void fetchActor(initialToken);
  }, [fetchActor]);

  const switchPersona = async (newPersonaId: string) => {
    const target = PRESET_PERSONAS.find((p) => p.id === newPersonaId);
    if (!target) return;

    const newToken = target.token || null;
    setSelectedPersona(newPersonaId);
    setAuthToken(newToken);
    setPersonaIdState(newPersonaId);
    setTokenState(newToken);

    await fetchActor(newToken);
  };

  const setCustomToken = async (newToken: string) => {
    const trimmed = newToken.trim();
    setSelectedPersona('custom');
    setAuthToken(trimmed || null);
    setPersonaIdState('custom');
    setTokenState(trimmed || null);
    await fetchActor(trimmed || null);
  };

  const login = async () => {
    if (typeof window === 'undefined') return;
    const issuer =
      process.env.NEXT_PUBLIC_OIDC_ISSUER || 'http://localhost:8080/realms/solutions-studio';
    const authEndpoint =
      process.env.NEXT_PUBLIC_OIDC_AUTHORIZATION_ENDPOINT ||
      `${issuer.replace(/\/$/, '')}/protocol/openid-connect/auth`;
    const clientId = process.env.NEXT_PUBLIC_OIDC_CLIENT_ID || 'solutions-studio-web';
    const redirectUri = `${window.location.origin}${window.location.pathname}`;

    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const state = generateRandomString(32);

    savePkceState(state, verifier);

    const authUrl = buildAuthorizationUrl({
      authorizationEndpoint: authEndpoint,
      clientId,
      redirectUri,
      state,
      codeChallenge: challenge
    });

    window.location.href = authUrl;
  };

  const logout = () => {
    resetAuthStore();
    setTokenState(null);
    setActor(null);
    setPersonaIdState('anonymous');
  };

  const hasCapability = useCallback(
    (cap: string): boolean => {
      if (!actor) return false;
      return actor.capabilities.includes(cap as ApplicationCapabilityDto);
    },
    [actor]
  );

  const contextValue = useMemo<AuthContextValue>(
    () => ({
      actor,
      token,
      personaId,
      personas: PRESET_PERSONAS,
      isLoading,
      hasCapability,
      switchPersona,
      setCustomToken,
      refreshActor: () => fetchActor(token),
      login,
      logout
    }),
    [actor, token, personaId, isLoading, hasCapability, fetchActor]
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    return {
      actor: null,
      token: null,
      personaId: 'anonymous',
      personas: PRESET_PERSONAS,
      isLoading: false,
      hasCapability: () => false,
      switchPersona: async () => {},
      setCustomToken: async () => {},
      refreshActor: async () => {},
      login: async () => {},
      logout: () => {}
    };
  }
  return ctx;
}
