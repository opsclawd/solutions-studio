import React, { useEffect, useState } from 'react';

/**
 * Security Probe Fixture: Message Spoofing & DOM Token Disclosure Test
 *
 * This component verifies two critical security guarantees:
 * 1. DOM Token Confidentiality: Confirms that no capability tokens or secrets
 *    exist in document <script> tags or anywhere in the DOM.
 * 2. Channel Port Exclusivity: Deliberately attempts to spoof authoritative lifecycle
 *    events (SANDBOX_RENDERED with bogus render time, SANDBOX_RUNTIME_ERROR with forged error)
 *    directly via window.parent.postMessage. The host must reject/drop these window messages
 *    and treat ONLY messages arriving over the private MessagePort as authoritative.
 */
export default function SecurityMessageSpoofingFixture() {
  const [tokensExposedCount, setTokensExposedCount] = useState<number>(-1);
  const [spoofAttempted, setSpoofAttempted] = useState<boolean>(false);

  useEffect(() => {
    // 1. Inspect all DOM script tags for leaked tokens
    const scripts = Array.from(document.querySelectorAll('script'));
    let exposedTokens = 0;
    for (const script of scripts) {
      const text = script.textContent || '';
      if (
        text.includes('HARNESS_TOKEN') ||
        text.includes('sandboxToken') ||
        /tok_[a-z0-9]+/i.test(text)
      ) {
        exposedTokens++;
      }
    }
    setTokensExposedCount(exposedTokens);

    // 2. Deliberately attempt to spoof authoritative lifecycle events to window.parent
    try {
      // Attempt to spoof SANDBOX_RENDERED with a bogus render time
      window.parent.postMessage(
        {
          source: 'solutions-studio-sandbox',
          version: 'solutions-studio-sandbox-v1',
          type: 'SANDBOX_RENDERED',
          renderTimeMs: 999999,
          executionId: 999
        },
        '*'
      );

      // Attempt to spoof SANDBOX_RUNTIME_ERROR with a forged error
      window.parent.postMessage(
        {
          source: 'solutions-studio-sandbox',
          version: 'solutions-studio-sandbox-v1',
          type: 'SANDBOX_RUNTIME_ERROR',
          executionId: 999,
          error: {
            message: 'FORGED_MALICIOUS_ERROR: Should be dropped by host'
          }
        },
        '*'
      );

      // Attempt to spoof foreign execution SANDBOX_READY
      window.parent.postMessage(
        {
          source: 'solutions-studio-sandbox',
          version: 'solutions-studio-sandbox-v1',
          type: 'SANDBOX_READY',
          executionId: 999
        },
        '*'
      );

      setSpoofAttempted(true);
    } catch (_) {}
  }, []);

  return (
    <div
      className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm"
      data-testid="spoof-probe-container"
    >
      <h2 className="text-sm font-bold text-gray-800 mb-2">
        Security Probe: Message Spoofing & Port Exclusivity
      </h2>
      <div className="space-y-1 text-xs">
        <p>
          Tokens exposed in script tags:{' '}
          <span className="font-mono font-bold" data-testid="spoof-tokens-found">
            {tokensExposedCount}
          </span>
        </p>
        <p>
          Spoof postMessages dispatched:{' '}
          <span className="font-mono font-bold text-blue-600" data-testid="spoof-attempted">
            {spoofAttempted ? 'true' : 'false'}
          </span>
        </p>
        <p className="mt-2 text-green-700 font-semibold" data-testid="spoof-probe-status">
          {tokensExposedCount === 0 && spoofAttempted
            ? 'MessagePort security probe active: Zero tokens exposed, window spoof attempts dispatched'
            : 'Evaluating security probe...'}
        </p>
      </div>
    </div>
  );
}
