import { describe, it, expect } from 'vitest';
import { GatewayFactory } from '../../src/infrastructure/generation/GatewayFactory.js';
import { AntigravityCliAdapter } from '../../src/infrastructure/generation/AntigravityCliAdapter.js';
import { OpenCodeCliAdapter } from '../../src/infrastructure/generation/OpenCodeCliAdapter.js';
import type { IGenerationGateway } from '../../src/application/ports/generation/IGenerationGateway.js';

describe('GatewayFactory', () => {
  it('creates AntigravityCliAdapter and threads model and other options', () => {
    const gateway = GatewayFactory.createGateway({
      provider: 'agy',
      agyBinPath: '/usr/local/bin/agy-custom',
      timeoutMs: 45_000,
      model: 'gemini-3.1-pro-high',
      cwd: '/tmp/workspace'
    });

    expect(gateway).toBeInstanceOf(AntigravityCliAdapter);
    const agyAdapter = gateway as unknown as {
      model?: string;
      executablePath: string;
      defaultTimeoutMs: number;
      cwd?: string;
    };
    expect(agyAdapter.model).toBe('gemini-3.1-pro-high');
    expect(agyAdapter.executablePath).toBe('/usr/local/bin/agy-custom');
    expect(agyAdapter.defaultTimeoutMs).toBe(45_000);
    expect(agyAdapter.cwd).toBe('/tmp/workspace');
  });

  it('creates OpenCodeCliAdapter and threads model and other options', () => {
    const gateway = GatewayFactory.createGateway({
      provider: 'opencode',
      opencodeBinPath: '/usr/local/bin/opencode-custom',
      timeoutMs: 60_000,
      model: 'minimax-coding-plan/MiniMax-M3',
      cwd: '/tmp/workspace'
    });

    expect(gateway).toBeInstanceOf(OpenCodeCliAdapter);
    const opencodeAdapter = gateway as unknown as {
      model?: string;
      executablePath: string;
      defaultTimeoutMs: number;
      cwd?: string;
    };
    expect(opencodeAdapter.model).toBe('minimax-coding-plan/MiniMax-M3');
    expect(opencodeAdapter.executablePath).toBe('/usr/local/bin/opencode-custom');
    expect(opencodeAdapter.defaultTimeoutMs).toBe(60_000);
    expect(opencodeAdapter.cwd).toBe('/tmp/workspace');
  });

  it('creates adapters with undefined model when model is not provided', () => {
    const agyGateway = GatewayFactory.createGateway({ provider: 'agy' });
    expect((agyGateway as unknown as { model?: string }).model).toBeUndefined();

    const opencodeGateway = GatewayFactory.createGateway({ provider: 'opencode' });
    expect((opencodeGateway as unknown as { model?: string }).model).toBeUndefined();
  });

  it('delegates to fallback for fixture-replay and fake providers', () => {
    const fallback: IGenerationGateway = {
      async generate() {
        return { text: 'mock' };
      }
    };

    const replayGateway = GatewayFactory.createGateway({ provider: 'fixture-replay' }, fallback);
    expect(replayGateway).toBe(fallback);

    const fakeGateway = GatewayFactory.createGateway({ provider: 'fake' }, fallback);
    expect(fakeGateway).toBe(fallback);
  });

  it('throws error when provider is unsupported', () => {
    expect(() => GatewayFactory.createGateway({ provider: 'unsupported' as any })).toThrow(
      /Unsupported generation provider: 'unsupported'/
    );
  });
});
