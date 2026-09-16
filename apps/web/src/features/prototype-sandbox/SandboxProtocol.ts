/**
 * SandboxProtocol: Type-safe, capability-hardened messaging protocol between Host and Sandboxed Iframe.
 *
 * All messages pass via window.postMessage.
 * To ensure isolation and prevent message spoofing:
 * - The host verifies event.source === iframe.contentWindow
 * - Messages carry a mandatory source discriminator ('solutions-studio-sandbox')
 * - Messages carry a mandatory protocol version ('solutions-studio-sandbox-v1')
 * - Messages carry a mandatory executionId epoch counter
 * - Messages carry a private per-execution capability token (sandboxToken)
 * - Complete payload shapes are strictly validated per message type
 */

export const PROTOCOL_VERSION = 'solutions-studio-sandbox-v1' as const;
export const SANDBOX_MESSAGE_SOURCE = 'solutions-studio-sandbox' as const;

export interface SandboxBaseMessage {
  source: typeof SANDBOX_MESSAGE_SOURCE;
  version: typeof PROTOCOL_VERSION;
  executionId: number;
  token: string;
}

// Host -> Sandbox Messages
export interface SandboxExecuteMessage extends SandboxBaseMessage {
  type: 'SANDBOX_EXECUTE';
  code: string;
  props?: Record<string, unknown>;
}

export interface SandboxPingMessage extends SandboxBaseMessage {
  type: 'SANDBOX_PING';
}

export interface SandboxResetMessage extends SandboxBaseMessage {
  type: 'SANDBOX_RESET';
}

export type SandboxHostMessage =
  | SandboxExecuteMessage
  | SandboxPingMessage
  | SandboxResetMessage;

// Sandbox -> Host Messages
export interface SandboxReadyMessage extends SandboxBaseMessage {
  type: 'SANDBOX_READY';
}

export interface SandboxRenderedMessage extends SandboxBaseMessage {
  type: 'SANDBOX_RENDERED';
  renderTimeMs: number;
}

export interface SandboxRuntimeErrorMessage extends SandboxBaseMessage {
  type: 'SANDBOX_RUNTIME_ERROR';
  error: {
    message: string;
    name?: string;
    stack?: string;
    componentStack?: string;
  };
}

export interface SandboxSecurityViolationMessage extends SandboxBaseMessage {
  type: 'SANDBOX_SECURITY_VIOLATION';
  violation: string;
  details?: string;
}

export interface SandboxActionMessage extends SandboxBaseMessage {
  type: 'SANDBOX_ACTION';
  actionName: string;
  payload?: unknown;
}

export type SandboxClientMessage =
  | SandboxReadyMessage
  | SandboxRenderedMessage
  | SandboxRuntimeErrorMessage
  | SandboxSecurityViolationMessage
  | SandboxActionMessage;

export type SandboxMessage = SandboxHostMessage | SandboxClientMessage;

export function isSandboxMessage(data: unknown): data is SandboxMessage {
  if (typeof data !== 'object' || data === null) return false;
  const candidate = data as Partial<SandboxMessage>;
  return (
    candidate.source === SANDBOX_MESSAGE_SOURCE &&
    candidate.version === PROTOCOL_VERSION &&
    typeof candidate.executionId === 'number' &&
    typeof candidate.token === 'string' &&
    typeof candidate.type === 'string'
  );
}

export function isSandboxClientMessage(data: unknown): data is SandboxClientMessage {
  if (!isSandboxMessage(data)) return false;

  switch (data.type) {
    case 'SANDBOX_READY':
      return true;
    case 'SANDBOX_RENDERED': {
      const msg = data as Partial<SandboxRenderedMessage>;
      return typeof msg.renderTimeMs === 'number';
    }
    case 'SANDBOX_RUNTIME_ERROR': {
      const msg = data as Partial<SandboxRuntimeErrorMessage>;
      return (
        typeof msg.error === 'object' &&
        msg.error !== null &&
        typeof msg.error.message === 'string'
      );
    }
    case 'SANDBOX_SECURITY_VIOLATION': {
      const msg = data as Partial<SandboxSecurityViolationMessage>;
      return typeof msg.violation === 'string';
    }
    case 'SANDBOX_ACTION': {
      const msg = data as Partial<SandboxActionMessage>;
      return typeof msg.actionName === 'string';
    }
    default:
      return false;
  }
}

export function isSandboxHostMessage(data: unknown): data is SandboxHostMessage {
  if (!isSandboxMessage(data)) return false;

  switch (data.type) {
    case 'SANDBOX_EXECUTE': {
      const msg = data as Partial<SandboxExecuteMessage>;
      return typeof msg.code === 'string';
    }
    case 'SANDBOX_PING':
    case 'SANDBOX_RESET':
      return true;
    default:
      return false;
  }
}
