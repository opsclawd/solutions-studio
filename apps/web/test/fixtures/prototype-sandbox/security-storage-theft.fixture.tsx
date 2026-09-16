import React, { useState, useEffect } from 'react';

/**
 * Security Fixture: Host Storage Theft Attempt
 *
 * Verifies that code running inside sandbox="allow-scripts" (without allow-same-origin)
 * cannot read host localStorage, sessionStorage, or parent cookies.
 */
export default function SecurityStorageTheftFixture() {
  const [cookieResult, setCookieResult] = useState<string>('Testing cookie...');
  const [storageResult, setStorageResult] = useState<string>('Testing localStorage...');
  const [isCookieBlocked, setIsCookieBlocked] = useState<boolean>(false);
  const [isStorageBlocked, setIsStorageBlocked] = useState<boolean>(false);

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
      setStorageResult(`SECURITY BREACH: Read parent localStorage: ${testItem}`);
      setIsStorageBlocked(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStorageResult(`ISOLATION ENFORCED: ${msg}`);
      setIsStorageBlocked(true);
    }
  }, []);

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
            isStorageBlocked
              ? 'bg-green-50 border-green-300 text-green-800'
              : 'bg-red-50 border-red-300 text-red-800'
          }`}
        >
          {storageResult}
        </div>
      </div>

      <div className="text-xs text-gray-500">
        Status: <span data-testid="storage-isolation-status" className="font-bold">
          {isCookieBlocked && isStorageBlocked ? 'ISOLATED' : 'VULNERABLE'}
        </span>
      </div>
    </div>
  );
}
