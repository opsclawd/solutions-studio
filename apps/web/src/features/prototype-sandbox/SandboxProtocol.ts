/**
 * SandboxProtocol: Type-safe messaging protocol between Host and Sandboxed Iframe.
 *
 * All messages pass via window.postMessage.
 * To ensure isolation and prevent message spoofing:
 * - The host verifies event.source === iframe.contentWindow
 * - All messages carry a well-defined discriminator (source: 'solutions-studio-sandbox')
 * - Payload shapes are strictly validated
 */

export const PROTOCOL_VERSION = 'solutions-studio-sandbox-v1' as const;
export const SANDBOX_MESSAGE_SOURCE = 'solutions-studio-sandbox' as const;

// Host -> Sandbox Messages
export interface SandboxExecuteMessage {
  source: typeof SANDBOX_MESSAGE_SOURCE;
  version: typeof PROTOCOL_VERSION;
  type: 'SANDBOX_EXECUTE';
  code: string;
  props?: Record<string, unknown>;
  executionId?: number;
}

export interface SandboxPingMessage {
  source: typeof SANDBOX_MESSAGE_SOURCE;
  version: typeof PROTOCOL_VERSION;
  type: 'SANDBOX_PING';
}

export interface SandboxResetMessage {
  source: typeof SANDBOX_MESSAGE_SOURCE;
  version: typeof PROTOCOL_VERSION;
  type: 'SANDBOX_RESET';
}

export type SandboxHostMessage =
  | SandboxExecuteMessage
  | SandboxPingMessage
  | SandboxResetMessage;

export interface SandboxReadyMessage {
  source: typeof SANDBOX_MESSAGE_SOURCE;
  version: typeof PROTOCOL_VERSION;
  type: 'SANDBOX_READY';
  executionId?: number;
}

export interface SandboxRenderedMessage {
  source: typeof SANDBOX_MESSAGE_SOURCE;
  version: typeof PROTOCOL_VERSION;
  type: 'SANDBOX_RENDERED';
  renderTimeMs: number;
  executionId?: number;
}

export interface SandboxRuntimeErrorMessage {
  source: typeof SANDBOX_MESSAGE_SOURCE;
  version: typeof PROTOCOL_VERSION;
  type: 'SANDBOX_RUNTIME_ERROR';
  executionId?: number;
  error: {
    message: string;
    name?: string;
    stack?: string;
    componentStack?: string;
  };
}

export interface SandboxSecurityViolationMessage {
  source: typeof SANDBOX_MESSAGE_SOURCE;
  version: typeof PROTOCOL_VERSION;
  type: 'SANDBOX_SECURITY_VIOLATION';
  violation: string;
  details?: string;
}

export interface SandboxActionMessage {
  source: typeof SANDBOX_MESSAGE_SOURCE;
  version: typeof PROTOCOL_VERSION;
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
  return candidate.source === SANDBOX_MESSAGE_SOURCE;
}

export function isSandboxClientMessage(data: unknown): data is SandboxClientMessage {
  if (!isSandboxMessage(data)) return false;
  const clientTypes = [
    'SANDBOX_READY',
    'SANDBOX_RENDERED',
    'SANDBOX_RUNTIME_ERROR',
    'SANDBOX_SECURITY_VIOLATION',
    'SANDBOX_ACTION',
  ];
  return clientTypes.includes(data.type);
}

export function isSandboxHostMessage(data: unknown): data is SandboxHostMessage {
  if (!isSandboxMessage(data)) return false;
  const hostTypes = ['SANDBOX_EXECUTE', 'SANDBOX_PING', 'SANDBOX_RESET'];
  return hostTypes.includes(data.type);
}
