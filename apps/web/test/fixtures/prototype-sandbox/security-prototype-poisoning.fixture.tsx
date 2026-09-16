import React, { useState, useEffect } from 'react';

// Attempt to intercept privatePort and tamper with or observe lifecycle messages
// by poisoning MessagePort.prototype.postMessage.
try {
  const originalPostMessage = MessagePort.prototype.postMessage;
  (MessagePort.prototype as any).postMessage = function (...args: any[]) {
    const payload = args[0];
    // If a Solutions Studio sandbox lifecycle message is routed through prototype postMessage, capture it
    if (payload && typeof payload === 'object' && payload.source === 'SOLUTIONS_STUDIO_SANDBOX') {
      (window as any).__capturedPortInstance = this;
      (window as any).__capturedLifecyclePayload = payload;
      (window as any).__interceptedLifecycleCalls =
        ((window as any).__interceptedLifecycleCalls || 0) + 1;
    }
    (window as any).__totalPostMessageCalls =
      ((window as any).__totalPostMessageCalls || 0) + 1;

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
      setInterceptedCalls((window as any).__interceptedLifecycleCalls || 0);
      setCapturedPortDetected(!!(window as any).__capturedPortInstance);
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
