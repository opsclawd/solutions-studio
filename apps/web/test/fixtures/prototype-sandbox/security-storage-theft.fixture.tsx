import React, { useState, useEffect } from 'react';

/**
 * Security Fixture: Host Storage Theft Attempt
 *
 * Verifies that code running inside sandbox="allow-scripts" (without allow-same-origin)
 * cannot read host localStorage, host sessionStorage, or parent cookies.
 */
export default function SecurityStorageTheftFixture() {
  const [cookieResult, setCookieResult] = useState<string>('Testing cookie...');
  const [localStorageResult, setLocalStorageResult] = useState<string>('Testing localStorage...');
  const [sessionStorageResult, setSessionStorageResult] = useState<string>('Testing sessionStorage...');
  const [isCookieBlocked, setIsCookieBlocked] = useState<boolean>(false);
  const [isLocalStorageBlocked, setIsLocalStorageBlocked] = useState<boolean>(false);
  const [isSessionStorageBlocked, setIsSessionStorageBlocked] = useState<boolean>(false);

  useEffect(() => {
    // 1. Attempt parent cookie access
    try {
      const cookie = window.parent.document.cookie;
      setCookieResult(`SECURITY BREACH: Read parent cookies: ${cookie}`);
      setIsCookieBlocked(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCookieResult(`ISOLATION ENFORCED: ${msg}`);
      setIsCookieBlocked(true);
    }

    // 2. Attempt parent localStorage access
    try {
      const parentStorage = window.parent.localStorage;
      const testItem = parentStorage.getItem('host-auth-token');
      setLocalStorageResult(`SECURITY BREACH: Read parent localStorage: ${testItem}`);
      setIsLocalStorageBlocked(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setLocalStorageResult(`ISOLATION ENFORCED: ${msg}`);
      setIsLocalStorageBlocked(true);
    }

    // 3. Attempt parent sessionStorage access
    try {
      const parentSession = window.parent.sessionStorage;
      const secretItem = parentSession.getItem('host-session-secret');
      setSessionStorageResult(`SECURITY BREACH: Read parent sessionStorage: ${secretItem}`);
      setIsSessionStorageBlocked(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSessionStorageResult(`ISOLATION ENFORCED: ${msg}`);
      setIsSessionStorageBlocked(true);
    }
  }, []);

  const isFullyIsolated = isCookieBlocked && isLocalStorageBlocked && isSessionStorageBlocked;

  return (
    <div className="p-6 max-w-md mx-auto bg-white rounded-xl shadow-md space-y-4 border border-gray-200">
      <h2 className="text-lg font-bold text-gray-900" data-testid="storage-security-title">
        Host Storage & Cookie Theft Probe
      </h2>

      <div className="space-y-2">
        <div className="text-xs font-semibold text-gray-700">Cookie Access:</div>
        <div
          data-testid="cookie-probe-result"
          className={`p-2 rounded border text-xs font-mono whitespace-pre-wrap ${
            isCookieBlocked
              ? 'bg-green-50 border-green-300 text-green-800'
              : 'bg-red-50 border-red-300 text-red-800'
          }`}
        >
          {cookieResult}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold text-gray-700">LocalStorage Access:</div>
        <div
          data-testid="storage-probe-result"
          className={`p-2 rounded border text-xs font-mono whitespace-pre-wrap ${
            isLocalStorageBlocked
              ? 'bg-green-50 border-green-300 text-green-800'
              : 'bg-red-50 border-red-300 text-red-800'
          }`}
        >
          {localStorageResult}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold text-gray-700">SessionStorage Access:</div>
        <div
          data-testid="session-storage-probe-result"
          className={`p-2 rounded border text-xs font-mono whitespace-pre-wrap ${
            isSessionStorageBlocked
              ? 'bg-green-50 border-green-300 text-green-800'
              : 'bg-red-50 border-red-300 text-red-800'
          }`}
        >
          {sessionStorageResult}
        </div>
      </div>

      <div className="text-xs text-gray-500">
        Status: <span data-testid="storage-isolation-status" className="font-bold">
          {isFullyIsolated ? 'ISOLATED' : 'VULNERABLE'}
        </span>
      </div>
    </div>
  );
}
