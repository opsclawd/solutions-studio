import { describe, it, expect } from 'vitest';
import {
  isSandboxMessage,
  isSandboxClientMessage,
  isSandboxHostMessage,
  SANDBOX_MESSAGE_SOURCE,
  PROTOCOL_VERSION
} from '../../src/features/prototype-sandbox/SandboxProtocol';

describe('SandboxProtocol', () => {
  const validExecutionId = 1;

  it('correctly identifies valid client and host messages', () => {
    const readyMsg = {
      source: SANDBOX_MESSAGE_SOURCE,
      version: PROTOCOL_VERSION,
      type: 'SANDBOX_READY',
      executionId: validExecutionId
    };
    expect(isSandboxMessage(readyMsg)).toBe(true);
    expect(isSandboxClientMessage(readyMsg)).toBe(true);
    expect(isSandboxHostMessage(readyMsg)).toBe(false);

    const renderedMsg = {
      source: SANDBOX_MESSAGE_SOURCE,
      version: PROTOCOL_VERSION,
      type: 'SANDBOX_RENDERED',
      executionId: validExecutionId,
      renderTimeMs: 42
    };
    expect(isSandboxMessage(renderedMsg)).toBe(true);
    expect(isSandboxClientMessage(renderedMsg)).toBe(true);

    const executeMsg = {
      source: SANDBOX_MESSAGE_SOURCE,
      version: PROTOCOL_VERSION,
      type: 'SANDBOX_EXECUTE',
      code: 'console.log(1)',
      executionId: validExecutionId
    };
    expect(isSandboxMessage(executeMsg)).toBe(true);
    expect(isSandboxClientMessage(executeMsg)).toBe(false);
    expect(isSandboxHostMessage(executeMsg)).toBe(true);
  });

  it('rejects messages lacking mandatory executionId', () => {
    const noExecutionId = {
      source: SANDBOX_MESSAGE_SOURCE,
      version: PROTOCOL_VERSION,
      type: 'SANDBOX_READY'
    };
    expect(isSandboxMessage(noExecutionId)).toBe(false);
    expect(isSandboxClientMessage(noExecutionId)).toBe(false);
  });

  it('rejects invalid payload shapes for typed messages', () => {
    // SANDBOX_RENDERED requires numeric renderTimeMs
    const badRendered = {
      source: SANDBOX_MESSAGE_SOURCE,
      version: PROTOCOL_VERSION,
      type: 'SANDBOX_RENDERED',
      executionId: 1,
      renderTimeMs: 'fast' // invalid type
    };
    expect(isSandboxClientMessage(badRendered)).toBe(false);

    // SANDBOX_RUNTIME_ERROR requires error object with message string
    const badRuntimeError = {
      source: SANDBOX_MESSAGE_SOURCE,
      version: PROTOCOL_VERSION,
      type: 'SANDBOX_RUNTIME_ERROR',
      executionId: 1,
      error: 'string-instead-of-object'
    };
    expect(isSandboxClientMessage(badRuntimeError)).toBe(false);
  });

  it('rejects foreign or malformed messages', () => {
    expect(isSandboxMessage(null)).toBe(false);
    expect(isSandboxMessage({})).toBe(false);
    expect(isSandboxMessage({ source: 'foreign-app' })).toBe(false);
    expect(
      isSandboxClientMessage({ source: 'solutions-studio-sandbox', type: 'UNKNOWN_TYPE' })
    ).toBe(false);
  });
});
