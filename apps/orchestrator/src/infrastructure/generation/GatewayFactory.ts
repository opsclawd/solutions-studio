import type { IGenerationGateway } from '../../application/ports/generation/IGenerationGateway.js';
import { AntigravityCliAdapter } from './AntigravityCliAdapter.js';
import { OpenCodeCliAdapter } from './OpenCodeCliAdapter.js';

export type ProviderType = 'fake' | 'agy' | 'opencode' | 'fixture-replay';

export interface GatewayConfig {
  provider?: ProviderType;
  agyBinPath?: string;
  opencodeBinPath?: string;
  timeoutMs?: number;
  cwd?: string;
  model?: string;
}

export class GatewayFactory {
  static createGateway(
    config?: GatewayConfig,
    gatewayFallback?: IGenerationGateway
  ): IGenerationGateway {
    const provider = (config?.provider ??
      process.env.GENERATION_PROVIDER ??
      'fixture-replay') as ProviderType;

    switch (provider) {
      case 'agy':
        return new AntigravityCliAdapter({
          executablePath: config?.agyBinPath ?? process.env.AGY_BIN_PATH,
          defaultTimeoutMs: config?.timeoutMs,
          cwd: config?.cwd,
          model: config?.model
        });

      case 'opencode':
        return new OpenCodeCliAdapter({
          executablePath: config?.opencodeBinPath ?? process.env.OPENCODE_BIN_PATH,
          defaultTimeoutMs: config?.timeoutMs,
          cwd: config?.cwd,
          model: config?.model
        });

      case 'fixture-replay':
      case 'fake':
        if (gatewayFallback) {
          return gatewayFallback;
        }
        throw new Error(
          `Provider '${provider}' requested but no gateway instance was provided to factory.`
        );

      default:
        throw new Error(`Unsupported generation provider: '${provider}'`);
    }
  }
}
