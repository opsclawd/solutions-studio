'use client';

import React, { useState } from 'react';
import type { SandboxStatus, SandboxError } from '@/features/prototype-sandbox/SandboxFrame';
import { SandboxFrame } from '@/features/prototype-sandbox/SandboxFrame';
import {
  COUNTER_FIXTURE_CODE,
  VALVE_INSPECTION_FIXTURE_CODE,
  COMPILE_ERROR_FIXTURE_CODE,
  RUNTIME_ERROR_FIXTURE_CODE,
  INFINITE_LOOP_FIXTURE_CODE,
  ASYNC_HANG_FIXTURE_CODE,
  SECURITY_DOM_ESCAPE_FIXTURE_CODE,
  SECURITY_STORAGE_THEFT_FIXTURE_CODE,
  SECURITY_NETWORK_EXFILTRATION_FIXTURE_CODE,
  SECURITY_MESSAGE_SPOOFING_FIXTURE_CODE,
  SECURITY_PROTOTYPE_POISONING_FIXTURE_CODE
} from '@/features/prototype-sandbox/fixtures';

const FIXTURES: Record<string, { name: string; description: string; code: string }> = {
  counter: {
    name: 'Interactive Counter (State Transition)',
    description: 'Verifies React useState hook and user button click updates inside sandbox',
    code: COUNTER_FIXTURE_CODE
  },
  'valve-inspection': {
    name: 'Valve Inspection (PRD Business Rule)',
    description: 'Implements PRD synthetic rule: safe pressure range [450.0 - 850.0] PSI',
    code: VALVE_INSPECTION_FIXTURE_CODE
  },
  'compile-error': {
    name: 'Compile Error (Malformed TSX)',
    description:
      'Tests client-side Babel syntax error detection and structured line/col extraction',
    code: COMPILE_ERROR_FIXTURE_CODE
  },
  'runtime-error': {
    name: 'Runtime Error (Render Exception)',
    description: 'Verifies sandbox React ErrorBoundary catches exceptions without crashing host',
    code: RUNTIME_ERROR_FIXTURE_CODE
  },
  'infinite-loop': {
    name: 'Infinite Loop (AST Protection)',
    description: 'Proves compiler loop guard terminates synchronous while(true) after 1000ms',
    code: INFINITE_LOOP_FIXTURE_CODE
  },
  'async-hang': {
    name: 'Async Hang (Host Timeout Recovery)',
    description: 'Proves host timeout timer (4000ms) triggers teardown and iframe recreation',
    code: ASYNC_HANG_FIXTURE_CODE
  },
  'security-dom': {
    name: 'Security: Parent DOM Escape',
    description: 'Proves sandboxed code cannot access or mutate parent document',
    code: SECURITY_DOM_ESCAPE_FIXTURE_CODE
  },
  'security-storage': {
    name: 'Security: Host Storage / Cookie Theft',
    description: 'Proves sandboxed code cannot read host localStorage, sessionStorage, or cookies',
    code: SECURITY_STORAGE_THEFT_FIXTURE_CODE
  },
  'security-network': {
    name: 'Security: Multi-Vector Network Exfiltration',
    description: 'Proves CSP blocks fetch, XHR, sendBeacon, images, scripts, and navigation',
    code: SECURITY_NETWORK_EXFILTRATION_FIXTURE_CODE
  },
  'security-spoofing': {
    name: 'Security: Message Spoofing & Port Privacy',
    description:
      'Proves zero DOM script secrets and host drops spoofed window.parent lifecycle messages',
    code: SECURITY_MESSAGE_SPOOFING_FIXTURE_CODE
  },
  'security-prototype-poisoning': {
    name: 'Security: Prototype Poisoning Defense',
    description:
      'Proves overriding MessagePort.prototype.postMessage cannot intercept privatePort or alter lifecycle events',
    code: SECURITY_PROTOTYPE_POISONING_FIXTURE_CODE
  }
};

export default function DevSandboxPage() {
  const [selectedKey, setSelectedKey] = useState<string>('counter');
  const [sourceCode, setSourceCode] = useState<string>(FIXTURES.counter.code);
  const [, setStatus] = useState<SandboxStatus>('IDLE');
  const [, setLastError] = useState<SandboxError | null>(null);

  const handleStatusChange = React.useCallback((s: SandboxStatus) => {
    setStatus(s);
  }, []);

  const handleError = React.useCallback((err: SandboxError) => {
    setLastError(err);
  }, []);

  const handleFixtureChange = (key: string) => {
    setSelectedKey(key);
    if (FIXTURES[key]) {
      setSourceCode(FIXTURES[key].code);
      setLastError(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-100 p-4">
      {/* Top Header */}
      <header className="mb-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-gray-900" data-testid="page-title">
              Phase 0 Spike B — Prototype Sandbox Tracer
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
              Spike B Active
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Dynamic React/Tailwind compilation via{' '}
            <code className="font-mono">@babel/standalone</code> inside an isolated{' '}
            <code className="font-mono">sandbox=&quot;allow-scripts&quot;</code> iframe.
          </p>
        </div>

        {/* Fixture Selector */}
        <div className="flex items-center gap-2">
          <label
            htmlFor="fixture-select"
            className="text-xs font-medium text-gray-700 whitespace-nowrap"
          >
            Load Fixture:
          </label>
          <select
            id="fixture-select"
            data-testid="fixture-selector"
            value={selectedKey}
            onChange={(e) => handleFixtureChange(e.target.value)}
            className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
          >
            {Object.entries(FIXTURES).map(([key, item]) => (
              <option key={key} value={key}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Main Split-Pane Workspace */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left Pane: TSX Source Code Editor */}
        <div className="flex flex-col bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden min-h-[450px]">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-xs text-gray-700">TSX Component Source</span>
              <span className="text-[11px] text-gray-400 font-mono">Editable</span>
            </div>
            <button
              onClick={() => setSourceCode(FIXTURES[selectedKey].code)}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
              type="button"
            >
              Reset to Fixture
            </button>
          </div>
          <textarea
            data-testid="tsx-editor"
            value={sourceCode}
            onChange={(e) => setSourceCode(e.target.value)}
            spellCheck={false}
            className="flex-1 w-full p-4 font-mono text-xs text-gray-800 bg-gray-50 focus:bg-white focus:outline-none resize-none border-0 leading-relaxed"
          />
        </div>

        {/* Right Pane: Isolated Prototype Sandbox Container */}
        <div className="flex flex-col bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden min-h-[450px]">
          <SandboxFrame
            code={sourceCode}
            timeoutMs={3500}
            onStatusChange={handleStatusChange}
            onError={handleError}
            className="h-full"
            title="Interactive Prototype Preview"
          />
        </div>
      </div>
    </div>
  );
}
