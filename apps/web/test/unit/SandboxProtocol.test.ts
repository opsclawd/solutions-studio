import { describe, it, expect } from 'vitest';
import {
  isSandboxMessage,
  isSandboxClientMessage,
  isSandboxHostMessage,
  SANDBOX_MESSAGE_SOURCE,
  PROTOCOL_VERSION,
} from '../../src/features/prototype-sandbox/SandboxProtocol';

describe('SandboxProtocol', () => {
  it('correctly identifies valid client and host messages', () => {
    const readyMsg = {
      source: SANDBOX_MESSAGE_SOURCE,
      version: PROTOCOL_VERSION,
      type: 'SANDBOX_READY',
    };
    expect(isSandboxMessage(readyMsg)).toBe(true);
    expect(isSandboxClientMessage(readyMsg)).toBe(true);
    expect(isSandboxHostMessage(readyMsg)).toBe(false);

    const executeMsg = {
      source: SANDBOX_MESSAGE_SOURCE,
      version: PROTOCOL_VERSION,
      type: 'SANDBOX_EXECUTE',
      code: 'console.log(1)',
    };
    expect(isSandboxMessage(executeMsg)).toBe(true);
    expect(isSandboxClientMessage(executeMsg)).toBe(false);
    expect(isSandboxHostMessage(executeMsg)).toBe(true);
  });

  it('rejects foreign or malformed messages', () => {
    expect(isSandboxMessage(null)).toBe(false);
    expect(isSandboxMessage({})).toBe(false);
    expect(isSandboxMessage({ source: 'foreign-app' })).toBe(false);
    expect(isSandboxClientMessage({ source: 'solutions-studio-sandbox', type: 'UNKNOWN_TYPE' })).toBe(false);
  });
});
