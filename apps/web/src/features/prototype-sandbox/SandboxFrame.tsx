'use client';

/**
 * SandboxFrame: Host application React component rendering the isolated prototype iframe.
 *
 * Security & Reliability Invariants:
 * - sandboxed iframe: sandbox="allow-scripts" (strictly WITHOUT allow-same-origin).
 * - Origin of sandboxed iframe evaluates to 'null', preventing parent DOM/cookie/storage access.
 * - Source verification: verifies event.source === iframeRef.current?.contentWindow.
 * - Client-side Babel transpilation runs on host before touching iframe.
 * - Automatic timeout handling with iframe teardown and recreation if user code hangs.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { CompileErrorDetails } from './SandboxCompiler';
import { compileTsx } from './SandboxCompiler';
import type { RuntimeOptions } from './SandboxRuntime';
import { buildSandboxHtml } from './SandboxRuntime';
import type { SandboxExecuteMessage } from './SandboxProtocol';
import {
  isSandboxClientMessage,
  PROTOCOL_VERSION,
  SANDBOX_MESSAGE_SOURCE
} from './SandboxProtocol';

export type SandboxStatus =
  | 'IDLE'
  | 'COMPILING'
  | 'LOADING'
  | 'READY'
  | 'RENDERED'
  | 'COMPILE_ERROR'
  | 'RUNTIME_ERROR'
  | 'TIMEOUT';

export interface SandboxRuntimeErrorDetails {
  message: string;
  name?: string;
  stack?: string;
  componentStack?: string;
}

export type SandboxError =
  | { type: 'COMPILE_ERROR'; details: CompileErrorDetails }
  | { type: 'RUNTIME_ERROR'; details: SandboxRuntimeErrorDetails }
  | { type: 'TIMEOUT'; message: string };

export interface SandboxFrameProps {
  code: string;
  className?: string;
  timeoutMs?: number;
  runtimeOptions?: RuntimeOptions;
  onError?: (error: SandboxError) => void;
  onRendered?: (renderTimeMs: number) => void;
  onStatusChange?: (status: SandboxStatus) => void;
  title?: string;
  showDiagnostics?: boolean;
}

export const SandboxFrame: React.FC<SandboxFrameProps> = ({
  code,
  className = '',
  timeoutMs = 4000,
  runtimeOptions,
  onError,
  onRendered,
  onStatusChange,
  title = 'Solutions Studio Prototype Sandbox',
  showDiagnostics = true
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [status, setStatus] = useState<SandboxStatus>('IDLE');
  const [iframeKey, setIframeKey] = useState<number>(1);
  const [srcDoc, setSrcDoc] = useState<string>('');
  const [, setCompiledCode] = useState<string>('');
  const [compileError, setCompileError] = useState<CompileErrorDetails | null>(null);
  const [runtimeError, setRuntimeError] = useState<SandboxRuntimeErrorDetails | null>(null);
  const [renderTimeMs, setRenderTimeMs] = useState<number | null>(null);

  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCodeRef = useRef<string>('');
  const isInitialMountRef = useRef<boolean>(true);
  const executionIdRef = useRef<number>(0);
  const activePortRef = useRef<MessagePort | null>(null);
  const handshakeCompletedRef = useRef<boolean>(false);

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;

  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  const updateStatus = useCallback((newStatus: SandboxStatus) => {
    setStatus(newStatus);
    onStatusChangeRef.current?.(newStatus);
  }, []);

  const clearTimeoutTimer = useCallback(() => {
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
  }, []);

  const closeActivePort = useCallback(() => {
    if (activePortRef.current) {
      activePortRef.current.close();
      activePortRef.current = null;
    }
  }, []);

  // Force recreation of the iframe DOM node on timeout or corruption
  const recreateIframe = useCallback(() => {
    clearTimeoutTimer();
    closeActivePort();
    handshakeCompletedRef.current = false;
    setIframeKey((prev) => prev + 1);
  }, [clearTimeoutTimer, closeActivePort]);

  // Handle authoritative lifecycle events over the private MessagePort
  const handlePortMessage = useCallback(
    (data: unknown) => {
      if (!isSandboxClientMessage(data)) {
        return;
      }

      if (data.executionId !== executionIdRef.current) {
        return;
      }

      switch (data.type) {
        case 'SANDBOX_RENDERED': {
          clearTimeoutTimer();
          setRenderTimeMs(data.renderTimeMs);
          updateStatus('RENDERED');
          onRenderedRef.current?.(data.renderTimeMs);
          break;
        }

        case 'SANDBOX_RUNTIME_ERROR': {
          clearTimeoutTimer();
          setRuntimeError(data.error);
          updateStatus('RUNTIME_ERROR');
          onErrorRef.current?.({ type: 'RUNTIME_ERROR', details: data.error });
          break;
        }
      }
    },
    [clearTimeoutTimer, updateStatus]
  );

  // Handle incoming handshake messages from the sandboxed iframe
  useEffect(() => {
    const handleWindowMessage = (event: MessageEvent) => {
      // 1. Enforce source boundary: message must originate from this specific iframe instance
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) {
        return;
      }

      const data = event.data;
      if (!isSandboxClientMessage(data)) {
        return;
      }

      // 2. Window postMessage is strictly limited to the initial SANDBOX_READY signal.
      // Any attempt by untrusted/generated code to spoof SANDBOX_RENDERED or SANDBOX_RUNTIME_ERROR
      // via window.parent.postMessage is dropped here.
      if (data.type !== 'SANDBOX_READY') {
        return;
      }

      // 3. Ignore redundant ready events once the private port handshake is completed
      if (handshakeCompletedRef.current) {
        return;
      }

      if (!pendingCodeRef.current) {
        return;
      }

      handshakeCompletedRef.current = true;
      updateStatus('READY');

      // 4. Create private MessageChannel for this execution epoch
      closeActivePort();
      const channel = new MessageChannel();
      activePortRef.current = channel.port1;

      channel.port1.onmessage = (portEvent: MessageEvent) => {
        handlePortMessage(portEvent.data);
      };

      // 5. Transfer port2 to iframe harness along with SANDBOX_EXECUTE command
      if (iframeRef.current?.contentWindow) {
        const executeMessage: SandboxExecuteMessage = {
          source: SANDBOX_MESSAGE_SOURCE,
          version: PROTOCOL_VERSION,
          type: 'SANDBOX_EXECUTE',
          code: pendingCodeRef.current,
          executionId: executionIdRef.current
        };
        iframeRef.current.contentWindow.postMessage(executeMessage, '*', [channel.port2]);
      }
    };

    window.addEventListener('message', handleWindowMessage);
    return () => {
      window.removeEventListener('message', handleWindowMessage);
      closeActivePort();
    };
  }, [clearTimeoutTimer, updateStatus, handlePortMessage, closeActivePort]);

  // Transpile and load code whenever code prop changes
  useEffect(() => {
    const trimmed = code.trim();
    if (!trimmed) {
      updateStatus('IDLE');
      setCompileError(null);
      setRuntimeError(null);
      setCompiledCode('');
      setSrcDoc('');
      pendingCodeRef.current = '';
      closeActivePort();
      handshakeCompletedRef.current = false;
      clearTimeoutTimer();
      return;
    }

    clearTimeoutTimer();
    closeActivePort();
    handshakeCompletedRef.current = false;
    setCompileError(null);
    setRuntimeError(null);
    updateStatus('COMPILING');

    // Increment execution epoch
    executionIdRef.current += 1;

    // 1. Transpile in host via Babel
    const result = compileTsx(trimmed);
    if (!result.success) {
      pendingCodeRef.current = '';
      setCompiledCode('');
      setCompileError(result.error);
      updateStatus('COMPILE_ERROR');
      setSrcDoc('');
      onErrorRef.current?.({ type: 'COMPILE_ERROR', details: result.error });
      return;
    }

    // 2. Prepare execution payload
    setCompiledCode(result.code);
    pendingCodeRef.current = result.code;
    updateStatus('LOADING');

    // 3. Prepare iframe srcDoc HTML with epoch ID
    const html = buildSandboxHtml({
      ...runtimeOptions,
      executionId: executionIdRef.current
    });
    setSrcDoc(html);

    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
    } else {
      setIframeKey((prevKey) => prevKey + 1);
    }

    // 4. Arm timeout timer
    timeoutTimerRef.current = setTimeout(() => {
      updateStatus('TIMEOUT');
      pendingCodeRef.current = '';
      closeActivePort();
      handshakeCompletedRef.current = false;
      const timeoutMessage = `Sandbox execution timed out after ${timeoutMs}ms. Possible infinite loop or unresponsive component.`;
      onErrorRef.current?.({ type: 'TIMEOUT', message: timeoutMessage });
      recreateIframe();
    }, timeoutMs);

    return () => {
      clearTimeoutTimer();
      closeActivePort();
    };
  }, [
    code,
    timeoutMs,
    runtimeOptions,
    updateStatus,
    clearTimeoutTimer,
    closeActivePort,
    recreateIframe
  ]);

  return (
    <div
      className={`sandbox-frame-container flex flex-col w-full h-full bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm ${className}`}
    >
      {/* Diagnostics / Status Header */}
      {showDiagnostics && (
        <div className="sandbox-header flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs text-gray-600">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-700">Sandbox Status:</span>
            <span
              data-testid="sandbox-status-badge"
              className={`px-2 py-0.5 rounded font-mono font-medium ${
                status === 'RENDERED'
                  ? 'bg-green-100 text-green-700'
                  : status === 'COMPILE_ERROR' || status === 'RUNTIME_ERROR' || status === 'TIMEOUT'
                    ? 'bg-red-100 text-red-700'
                    : status === 'COMPILING' || status === 'LOADING'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-gray-100 text-gray-600'
              }`}
            >
              {status}
            </span>
            {renderTimeMs !== null && status === 'RENDERED' && (
              <span data-testid="render-time-badge" className="text-gray-400">
                ({renderTimeMs}ms)
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-400 font-mono text-[10px]">
              sandbox=&quot;allow-scripts&quot;
            </span>
            <button
              onClick={recreateIframe}
              className="px-2 py-1 text-[11px] rounded bg-white hover:bg-gray-100 border border-gray-300 text-gray-700 shadow-sm transition"
              title="Reset Sandbox Iframe"
              type="button"
            >
              Reset Frame
            </button>
          </div>
        </div>
      )}

      {/* Structured Compile Error Banner */}
      {status === 'COMPILE_ERROR' && compileError && (
        <div
          data-testid="sandbox-compile-error-banner"
          className="p-3 bg-red-50 border-b border-red-200 text-red-700 text-xs"
        >
          <div className="flex items-center gap-1 font-semibold mb-1">
            <span>Compile Error</span>
            {compileError.line !== undefined && (
              <span className="font-mono bg-red-100 px-1 py-0.5 rounded">
                Line {compileError.line}:{compileError.column ?? 0}
              </span>
            )}
          </div>
          <p className="font-mono whitespace-pre-wrap">{compileError.message}</p>
          {compileError.snippet && (
            <pre className="mt-2 p-2 bg-white rounded border border-red-200 overflow-x-auto font-mono text-[11px]">
              {compileError.snippet}
            </pre>
          )}
        </div>
      )}

      {/* Structured Runtime Error Banner */}
      {status === 'RUNTIME_ERROR' && runtimeError && (
        <div
          data-testid="sandbox-runtime-error-banner"
          className="p-3 bg-red-50 border-b border-red-200 text-red-700 text-xs"
        >
          <div className="font-semibold mb-1">Runtime Exception Captured</div>
          <p className="font-mono mb-1">{runtimeError.message}</p>
          {runtimeError.stack && (
            <pre className="mt-1 p-2 bg-white rounded border border-red-200 overflow-x-auto font-mono text-[11px] max-h-32">
              {runtimeError.stack}
            </pre>
          )}
        </div>
      )}

      {/* Timeout Banner */}
      {status === 'TIMEOUT' && (
        <div
          data-testid="sandbox-timeout-banner"
          className="p-3 bg-yellow-50 border-b border-yellow-200 text-yellow-800 text-xs flex items-center justify-between"
        >
          <div>
            <span className="font-semibold">Execution Timeout:</span> Component exceeded {timeoutMs}
            ms execution budget. Iframe was reset for safety.
          </div>
          <button
            onClick={recreateIframe}
            className="px-2 py-1 rounded bg-yellow-100 hover:bg-yellow-200 border border-yellow-300 font-medium text-yellow-900"
            type="button"
          >
            Retry
          </button>
        </div>
      )}

      {/* Sandboxed Iframe */}
      <div className="flex-1 w-full h-full relative min-h-[300px]">
        <iframe
          key={iframeKey}
          ref={iframeRef}
          data-testid="sandbox-iframe"
          title={title}
          srcDoc={srcDoc}
          sandbox="allow-scripts"
          className="w-full h-full border-0 absolute inset-0 bg-white"
        />
      </div>
    </div>
  );
};

export default SandboxFrame;
