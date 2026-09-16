import React, { useState, useEffect } from 'react';

/**
 * Security Fixture: Parent DOM Boundary Escape Attempt
 *
 * Verifies that code running inside sandbox="allow-scripts" (without allow-same-origin)
 * cannot traverse to the parent DOM or manipulate host elements.
 */
export default function SecurityDomEscapeFixture() {
  const [probeResult, setProbeResult] = useState<string>('Testing...');
  const [isBlocked, setIsBlocked] = useState<boolean>(false);

  useEffect(() => {
    try {
      // Attempt to access parent document title or body
      const parentDoc = window.parent.document;
      // If we reach this line, isolation failed!
      setProbeResult(`SECURITY BREACH: Accessed parent document: ${parentDoc.title}`);
      setIsBlocked(false);
    } catch (err: unknown) {
      // Expected SecurityError: Blocked a frame with origin "null" from accessing a cross-origin frame.
      const errorMsg = err instanceof Error ? err.message : String(err);
      setProbeResult(`ISOLATION ENFORCED: ${errorMsg}`);
      setIsBlocked(true);
    }
  }, []);

  return (
    <div className="p-6 max-w-md mx-auto bg-white rounded-xl shadow-md space-y-4 border border-gray-200">
      <h2 className="text-lg font-bold text-gray-900" data-testid="security-title">
        Parent DOM Boundary Probe
      </h2>
      <p className="text-sm text-gray-600">
        Attempts to access{' '}
        <code className="bg-gray-100 px-1 py-0.5 rounded font-mono text-xs">
          window.parent.document
        </code>
        .
      </p>

      <div
        data-testid="dom-probe-result"
        className={`p-3 rounded-md border text-xs font-mono whitespace-pre-wrap ${
          isBlocked
            ? 'bg-green-50 border-green-300 text-green-800'
            : 'bg-red-50 border-red-300 text-red-800'
        }`}
      >
        {probeResult}
      </div>

      <div className="text-xs text-gray-500">
        Status:{' '}
        <span data-testid="dom-isolation-status" className="font-bold">
          {isBlocked ? 'BLOCKED' : 'BREACHED'}
        </span>
      </div>
    </div>
  );
}
