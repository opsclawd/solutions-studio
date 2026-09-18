import type { EvaluationManifestDto, EvaluationFixtureDto } from '@solutions-studio/contracts';
import type { IRequirementsRepository } from '../ports/persistence/IRequirementsRepository.js';
import type { IGenerationGateway } from '../ports/generation/IGenerationGateway.js';
import type { SourceType, Instant } from '@solutions-studio/domain';
import type { SourceLineageMap } from './validateSourceLineage.js';
import type { SourceRevisionRecord } from '../ports/persistence/IRequirementsRepository.js';

export interface LoadedSourceRevision {
  readonly text: string;
  readonly contentHash: string;
  readonly sourceId: string;
  readonly sourceType: SourceType;
  readonly revision: number;
}

export interface LoadedFixture {
  readonly fixture: EvaluationFixtureDto;
  readonly fixtureDir: string;
  readonly sourceRevisions: Map<string, LoadedSourceRevision>;
  readonly expectedJsonHash: string;
}

export interface LoadedCorpus {
  readonly manifest: EvaluationManifestDto;
  readonly manifestPath: string;
  readonly fixtures: Map<string, LoadedFixture>;
}

export type ICorpusLoader = (manifestPath?: string) => LoadedCorpus;

export type IFixtureRepositoryFactory = (
  fixtureStoreDir: string,
  fixtureId: string
) => Promise<IRequirementsRepository> | IRequirementsRepository;

export interface FixtureGatewayContext {
  readonly fixtureId: string;
  readonly fixture: EvaluationFixtureDto;
  readonly lineageMap: SourceLineageMap;
  readonly capturedRecords: readonly SourceRevisionRecord[];
}

export type IEvaluationGatewayFactory = (
  context: FixtureGatewayContext
) => Promise<IGenerationGateway> | IGenerationGateway;

export type IClock = () => Instant;
