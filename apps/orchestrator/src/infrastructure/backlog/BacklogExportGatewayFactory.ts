import type { IBacklogExportGateway } from '../../application/ports/backlog/IBacklogExportGateway.js';
import {
  GitHubIssuesBacklogExportAdapter,
  type GitHubIssuesAdapterOptions
} from './GitHubIssuesBacklogExportAdapter.js';

export interface BacklogExportGatewayFactoryOptions {
  readonly defaultProvider?: string;
  readonly githubOptions?: GitHubIssuesAdapterOptions;
  readonly customGateways?: Record<string, IBacklogExportGateway>;
}

export class BacklogExportGatewayFactory {
  private readonly defaultProvider: string;
  private readonly gateways = new Map<string, IBacklogExportGateway>();

  constructor(options: BacklogExportGatewayFactoryOptions = {}) {
    this.defaultProvider =
      options.defaultProvider ?? process.env.BACKLOG_PROVIDER ?? 'github-issues';

    if (options.customGateways) {
      for (const [key, gw] of Object.entries(options.customGateways)) {
        this.gateways.set(key, gw);
      }
    }

    if (!this.gateways.has('github-issues')) {
      this.gateways.set(
        'github-issues',
        new GitHubIssuesBacklogExportAdapter(options.githubOptions)
      );
    }
  }

  getGateway(providerId?: string): IBacklogExportGateway {
    const selected = providerId ?? this.defaultProvider;
    const gateway = this.gateways.get(selected);
    if (!gateway) {
      throw new Error(`Unsupported backlog export provider: '${selected}'`);
    }
    return gateway;
  }

  registerGateway(providerId: string, gateway: IBacklogExportGateway): void {
    this.gateways.set(providerId, gateway);
  }
}
