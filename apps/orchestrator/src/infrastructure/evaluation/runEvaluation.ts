import { now } from '@solutions-studio/domain';
import type { EvaluationReportDto } from '@solutions-studio/contracts';
import { FilesystemRequirementsRepository } from '../persistence/filesystem/FilesystemRequirementsRepository.js';
import {
  GatewayFactory,
  type ProviderType,
  type GatewayConfig
} from '../generation/GatewayFactory.js';
import {
  FixtureReplayGenerationGateway,
  type FixtureReplayRegistration
} from '../generation/FixtureReplayGenerationGateway.js';
import { loadManifest } from './loadManifest.js';
import {
  EvaluateRequirementsCompilerUseCase,
  type EvaluateRequirementsCompilerPorts
} from '../../application/evaluation/EvaluateRequirementsCompilerUseCase.js';
import type {
  IRequirementsRepository,
  EvaluationRunRecord
} from '../../application/ports/persistence/IRequirementsRepository.js';
import type { IGenerationGateway } from '../../application/ports/generation/IGenerationGateway.js';

export interface RunEvaluationOptions {
  readonly repository?: IRequirementsRepository;
  readonly candidateSha?: string;
  readonly outputReportPath?: string;
  readonly outputMarkdownPath?: string;
  readonly manifestPath?: string;
  readonly provider?: ProviderType;
  readonly gatewayConfig?: GatewayConfig;
  readonly customGateway?: IGenerationGateway;
  readonly storeDir?: string;
}

export interface LegacyEvaluationSummary {
  readonly totalFixtures: number;
  readonly passedFixtures: number;
  readonly failedFixtures: number;
  readonly totalCategories: number;
  readonly coveredCategories: readonly string[];
}

export type LegacyCompatibleEvaluationReport = EvaluationReportDto & {
  readonly summary: LegacyEvaluationSummary;
};

export interface RunEvaluationResult {
  readonly runRecord: EvaluationRunRecord;
  readonly report: LegacyCompatibleEvaluationReport;
  readonly humanReport: string;
  readonly success: boolean;
}

export function createDefaultEvaluationPorts(
  options?: RunEvaluationOptions
): EvaluateRequirementsCompilerPorts {
  const providerMode: ProviderType = options?.provider ?? 'fixture-replay';

  return {
    corpusLoader: (manifestPath?: string) => loadManifest(manifestPath),
    fixtureRepositoryFactory: (fixtureStoreDir: string) =>
      new FilesystemRequirementsRepository({ baseDir: fixtureStoreDir }),
    gatewayFactory: (ctx) => {
      if (options?.customGateway) {
        return options.customGateway;
      }
      if (providerMode === 'fixture-replay') {
        const replayRegistration: FixtureReplayRegistration = {
          fixture: ctx.fixture,
          lineageEntries: ctx.lineageMap.entries,
          expectedCapturedIds: ctx.capturedRecords.map((r) => r.revision.id)
        };
        return new FixtureReplayGenerationGateway([replayRegistration]);
      }
      return GatewayFactory.createGateway(options?.gatewayConfig ?? { provider: providerMode });
    },
    clock: now
  };
}

export async function runEvaluation(options?: RunEvaluationOptions): Promise<RunEvaluationResult> {
  const ports = createDefaultEvaluationPorts(options);
  const useCase = new EvaluateRequirementsCompilerUseCase(ports);
  const result = await useCase.execute({
    ...options,
    provider: options?.provider ?? 'fixture-replay',
    providerName: options?.customGateway
      ? 'custom-gateway'
      : (options?.provider ?? 'fixture-replay'),
    gatewayConfig: options?.gatewayConfig as Record<string, unknown> | undefined
  });

  const corpus = ports.corpusLoader(options?.manifestPath);
  const coveredCategories = new Set<string>();
  for (const [, loaded] of corpus.fixtures) {
    for (const cat of loaded.fixture.categories) {
      coveredCategories.add(cat);
    }
  }

  const legacySummary: LegacyEvaluationSummary = {
    totalFixtures: result.report.aggregateScores.totalFixtures,
    passedFixtures: result.report.aggregateScores.completedFixtures,
    failedFixtures: result.report.aggregateScores.failedFixtures,
    totalCategories: 10,
    coveredCategories: Array.from(coveredCategories).sort()
  };

  const compatibleReport: LegacyCompatibleEvaluationReport = Object.assign({}, result.report, {
    summary: legacySummary
  });

  return {
    runRecord: result.runRecord,
    report: compatibleReport,
    humanReport: result.humanReport,
    success: result.success
  };
}
