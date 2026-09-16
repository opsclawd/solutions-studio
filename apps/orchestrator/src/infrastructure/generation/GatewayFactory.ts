import type { IGenerationGateway } from '../../application/ports/generation/IGenerationGateway.js';
import { AntigravityCliAdapter } from './AntigravityCliAdapter.js';
import { OpenCodeCliAdapter } from './OpenCodeCliAdapter.js';

export type ProviderType = 'fake' | 'agy' | 'opencode';

export interface GatewayConfig {
  provider?: ProviderType;
  agyBinPath?: string;
  opencodeBinPath?: string;
  timeoutMs?: number;
  cwd?: string;
}

export class GatewayFactory {
  static createGateway(
    config?: GatewayConfig,
    fakeGatewayFallback?: IGenerationGateway
  ): IGenerationGateway {
    const provider = (config?.provider ??
      process.env.GENERATION_PROVIDER ??
      'fake') as ProviderType;

    switch (provider) {
      case 'agy':
        return new AntigravityCliAdapter({
          executablePath: config?.agyBinPath ?? process.env.AGY_BIN_PATH,
          defaultTimeoutMs: config?.timeoutMs,
          cwd: config?.cwd
        });

      case 'opencode':
        return new OpenCodeCliAdapter({
          executablePath: config?.opencodeBinPath ?? process.env.OPENCODE_BIN_PATH,
          defaultTimeoutMs: config?.timeoutMs,
          cwd: config?.cwd
        });

      case 'fake':
        if (fakeGatewayFallback) {
          return fakeGatewayFallback;
        }
        throw new Error(
          'Fake provider requested but no FakeGenerationGateway instance was provided to factory.'
        );

      default:
        throw new Error(`Unsupported generation provider: '${provider}'`);
    }
  }
}
