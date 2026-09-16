/**
 * SandboxRuntime: Generates the isolated iframe HTML document (srcDoc).
 *
 * Inlines:
 * - Content Security Policy meta tag (strict air-gapped boundaries)
 * - Self-contained Tailwind utility stylesheet
 * - React 18 & ReactDOM UMD libraries
 * - React ErrorBoundary & global unhandled error traps
 * - PostMessage execution harness adhering to SandboxProtocol
 */

import { buildCspMetaTag, SandboxCspOptions } from './SandboxCsp';
import { REACT_UMD, REACT_DOM_UMD } from './runtime-assets/react-bundles';
import { TAILWIND_SANDBOX_CSS } from './runtime-assets/tailwind-styles';
import { PROTOCOL_VERSION, SANDBOX_MESSAGE_SOURCE } from './SandboxProtocol';

export interface RuntimeOptions {
  cspOptions?: SandboxCspOptions;
  extraCss?: string;
  initialCode?: string;
  executionId?: number;
  channelId?: string;
}

export function buildSandboxHtml(options: RuntimeOptions = {}): string {
  const cspMeta = buildCspMetaTag(options.cspOptions);
  const extraCss = options.extraCss ? `\n${options.extraCss}\n` : '';

  // Escape any accidental </script> in inlined code
  const safeReact = REACT_UMD.replace(/<\/script>/gi, '<\\/script>');
  const safeReactDOM = REACT_DOM_UMD.replace(/<\/script>/gi, '<\\/script>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${cspMeta}
  <title>Solutions Studio Prototype Sandbox</title>
  <style>
${TAILWIND_SANDBOX_CSS}
${extraCss}
  </style>
  <script>
${safeReact}
  </script>
  <script>
${safeReactDOM}
  </script>
</head>
<body class="bg-transparent antialiased p-4">
  <div id="root"></div>

  <script>
(function() {
  'use strict';
  // Capture unpoisoned native MessagePort.prototype.postMessage before any untrusted user code can execute
  var nativePortPostMessage = (typeof window !== 'undefined' && window.MessagePort && window.MessagePort.prototype)
    ? window.MessagePort.prototype.postMessage
    : null;

  var PROTOCOL_VERSION = '${PROTOCOL_VERSION}';
  var SANDBOX_MESSAGE_SOURCE = '${SANDBOX_MESSAGE_SOURCE}';
  var currentExecutionId = ${options.executionId ?? 0};
  var privatePort = null;
  var sendToHost = null;

  function sendClientMessage(msg) {
    if (sendToHost) {
      sendToHost(msg);
    }
  }

  if (window.React && !window.React.default) {
    window.React.default = window.React;
  }
  if (window.ReactDOM && !window.ReactDOM.default) {
    window.ReactDOM.default = window.ReactDOM;
  }

  // Global uncaught error handler
  window.onerror = function(message, source, lineno, colno, error) {
    sendClientMessage({
      source: SANDBOX_MESSAGE_SOURCE,
      version: PROTOCOL_VERSION,
      type: 'SANDBOX_RUNTIME_ERROR',
      executionId: currentExecutionId,
      error: {
        message: message ? String(message) : 'Uncaught window error',
        stack: error && error.stack ? error.stack : undefined
      }
    });
    return false;
  };

  // Global unhandled promise rejection handler
  window.onunhandledrejection = function(event) {
    var reason = event.reason;
    sendClientMessage({
      source: SANDBOX_MESSAGE_SOURCE,
      version: PROTOCOL_VERSION,
      type: 'SANDBOX_RUNTIME_ERROR',
      executionId: currentExecutionId,
      error: {
        message: reason ? (reason.message || String(reason)) : 'Unhandled Promise Rejection',
        stack: reason && reason.stack ? reason.stack : undefined
      }
    });
  };

  // Top-level React ErrorBoundary component
  function createErrorBoundary() {
    var React = window.React;
    if (!React) return null;

    class SandboxErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
      }
      static getDerivedStateFromError(error) {
        return { hasError: true, error: error };
      }
      componentDidCatch(error, errorInfo) {
        sendClientMessage({
          source: SANDBOX_MESSAGE_SOURCE,
          version: PROTOCOL_VERSION,
          type: 'SANDBOX_RUNTIME_ERROR',
          executionId: currentExecutionId,
          error: {
            message: error ? (error.message || String(error)) : 'Render Error',
            stack: error && error.stack ? error.stack : undefined,
            componentStack: errorInfo && errorInfo.componentStack ? errorInfo.componentStack : undefined
          }
        });
      }
      render() {
        if (this.state.hasError) {
          return React.createElement(
            'div',
            { className: 'p-4 rounded-lg bg-red-50 border border-red-300 text-red-700 m-2', 'data-testid': 'sandbox-runtime-error-boundary' },
            React.createElement('h3', { className: 'font-bold text-sm mb-1' }, 'Runtime Render Exception'),
            React.createElement('p', { className: 'text-xs text-red-600 mb-2' }, this.state.error ? this.state.error.message : 'Unknown runtime error'),
            React.createElement('pre', { className: 'text-xs bg-white p-2 rounded border border-red-200 overflow-x-auto whitespace-pre-wrap' }, this.state.error && this.state.error.stack ? this.state.error.stack : '')
          );
        }
        return this.props.children;
      }
    }

    return SandboxErrorBoundary;
  }

  var currentRoot = null;

  // Execute received transpiled component code
  function executeComponent(code, props, execId) {
    var startTime = performance.now();
    var React = window.React;
    var ReactDOM = window.ReactDOM;
    currentExecutionId = execId;
    try {
      var exports = {};
      var module = { exports: exports };

      // Whitelisted module loader
      var require = function(modName) {
        if (modName === 'react') return window.React;
        if (modName === 'react-dom') return window.ReactDOM;
        if (modName === 'react/jsx-runtime') return window.React;
        throw new Error("Prohibited module import: '" + modName + "'. Sandbox runtime only allows ['react', 'react-dom'].");
      };

      // Construct runner function with injected scope
      var runner = new Function('require', 'module', 'exports', 'React', 'ReactDOM', code);
      runner(require, module, exports, window.React, window.ReactDOM);

      var Component = exports.default || module.exports;
      if (typeof Component !== 'function' && !(Component && typeof Component.render === 'function')) {
        throw new Error("Transpiled artifact did not export a valid React component as default export.");
      }

      var container = document.getElementById('root');
      if (!container) throw new Error("Sandbox container element '#root' not found.");

      if (!currentRoot) {
        currentRoot = window.ReactDOM.createRoot(container);
      }

      var ErrorBoundary = createErrorBoundary();

      function RenderNotifier(notifierProps) {
        React.useEffect(function() {
          notifierProps.onRendered();
        }, []);
        return null;
      }

      var onRenderedCallback = function() {
        var renderTimeMs = Math.round(performance.now() - startTime);
        sendClientMessage({
          source: SANDBOX_MESSAGE_SOURCE,
          version: PROTOCOL_VERSION,
          type: 'SANDBOX_RENDERED',
          renderTimeMs: renderTimeMs,
          executionId: execId
        });
      };

      var element = React.createElement(
        ErrorBoundary,
        null,
        React.createElement(
          React.Fragment,
          null,
          React.createElement(Component, props || {}),
          React.createElement(RenderNotifier, { onRendered: onRenderedCallback })
        )
      );

      currentRoot.render(element);
    } catch (err) {
      sendClientMessage({
        source: SANDBOX_MESSAGE_SOURCE,
        version: PROTOCOL_VERSION,
        type: 'SANDBOX_RUNTIME_ERROR',
        executionId: execId,
        error: {
          message: err ? (err.message || String(err)) : 'Execution failed',
          stack: err && err.stack ? err.stack : undefined
        }
      });
    }
  }

  // Handle messages over the private MessagePort
  function handlePortMessage(portEvent) {
    var data = portEvent.data;
    if (!data || data.source !== SANDBOX_MESSAGE_SOURCE) return;
    if (data.version !== PROTOCOL_VERSION) return;

    if (data.type === 'SANDBOX_PING') {
      sendClientMessage({
        source: SANDBOX_MESSAGE_SOURCE,
        version: PROTOCOL_VERSION,
        type: 'SANDBOX_READY',
        executionId: currentExecutionId
      });
      return;
    }

    if (data.type === 'SANDBOX_RESET') {
      var container = document.getElementById('root');
      if (container) container.innerHTML = '';
      return;
    }
  }

  // Initial window listener to receive SANDBOX_EXECUTE and extract the private MessagePort
  function handleWindowMessage(event) {
    var data = event.data;
    if (!data || data.source !== SANDBOX_MESSAGE_SOURCE) return;
    if (data.version !== PROTOCOL_VERSION) return;

    if (data.type === 'SANDBOX_EXECUTE') {
      if (event.ports && event.ports[0]) {
        privatePort = event.ports[0];
        if (nativePortPostMessage) {
          sendToHost = nativePortPostMessage.bind(privatePort);
        }
        privatePort.onmessage = handlePortMessage;
        if (typeof privatePort.start === 'function') {
          privatePort.start();
        }
      }

      // Immediately unregister window listener so no further window commands are processed
      window.removeEventListener('message', handleWindowMessage);

      currentExecutionId = data.executionId;
      executeComponent(data.code, data.props, data.executionId);
    }
  }

  window.addEventListener('message', handleWindowMessage);

  // Signal readiness when document is ready
  function notifyReady() {
    try {
      window.parent.postMessage({
        source: SANDBOX_MESSAGE_SOURCE,
        version: PROTOCOL_VERSION,
        type: 'SANDBOX_READY',
        executionId: currentExecutionId
      }, '*');
    } catch (_) {}
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(notifyReady, 0);
  } else {
    window.addEventListener('DOMContentLoaded', notifyReady);
  }
})();
  </script>
</body>
</html>`;
}
