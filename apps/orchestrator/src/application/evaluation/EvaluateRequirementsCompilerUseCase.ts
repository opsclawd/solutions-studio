import crypto, { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  now,
  createSourceId,
  type RequirementRevision,
  type CandidateFinding
} from '@solutions-studio/domain';
import {
  EvaluationReportSchema,
  SafeFixtureIdSchema,
  EVALUATION_REPORT_SCHEMA_VERSION,
  canonicalizeReportForDigest,
  type EvaluationReportDto,
  type GenerationMetadataDto,
  type EvaluationFixtureResultDto,
  type AvailableValueDto,
  type DeclaredFixtureDeclarationDto
} from '@solutions-studio/contracts';
import type {
  IRequirementsRepository,
  EvaluationRunRecord,
  SourceRevisionRecord
} from '../ports/persistence/IRequirementsRepository.js';
import {
  CompileRequirementsUseCase,
  COMPILER_VERSION,
  PROMPT_VERSION
} from '../use-cases/CompileRequirementsUseCase.js';
import type {
  LoadedCorpus,
  ICorpusLoader,
  IFixtureRepositoryFactory,
  IEvaluationGatewayFactory,
  IClock
} from './ports.js';
import { computeCorpusIdentity } from './computeCorpusIdentity.js';
import { validateSourceLineage, type SourceLineageMap } from './validateSourceLineage.js';
import { normalizeExpectedGroundTruth } from './normalizeExpectedGroundTruth.js';
import { scoreFixture } from './scoreFixture.js';
import { aggregateEvaluationScores } from './aggregateEvaluationScores.js';
import { renderJsonReport, renderHumanReport } from './renderEvaluationReport.js';
import { sanitizeFailureEvidence } from './sanitizeFailureEvidence.js';

export interface EvaluateRequirementsCompilerPorts {
  readonly corpusLoader: ICorpusLoader;
  readonly fixtureRepositoryFactory: IFixtureRepositoryFactory;
  readonly gatewayFactory: IEvaluationGatewayFactory;
  readonly clock?: IClock;
}

export interface EvaluateRequirementsCompilerOptions {
  readonly ports?: Partial<EvaluateRequirementsCompilerPorts>;
  readonly repository?: IRequirementsRepository;
  readonly candidateSha?: string;
  readonly outputReportPath?: string;
  readonly outputMarkdownPath?: string;
  readonly manifestPath?: string;
  readonly provider?: string;
  readonly providerName?: string;
  readonly gatewayConfig?: Record<string, unknown>;
  readonly storeDir?: string;
}

export interface EvaluationRunExecutionResult {
  readonly runRecord: EvaluationRunRecord;
  readonly report: EvaluationReportDto;
  readonly humanReport: string;
  readonly success: boolean;
}

export class EvaluateRequirementsCompilerUseCase {
  constructor(private readonly defaultPorts?: Partial<EvaluateRequirementsCompilerPorts>) {}

  async execute(
    options?: EvaluateRequirementsCompilerOptions
  ): Promise<EvaluationRunExecutionResult> {
    const corpusLoader = options?.ports?.corpusLoader ?? this.defaultPorts?.corpusLoader;
    const fixtureRepositoryFactory =
      options?.ports?.fixtureRepositoryFactory ?? this.defaultPorts?.fixtureRepositoryFactory;
    const gatewayFactory = options?.ports?.gatewayFactory ?? this.defaultPorts?.gatewayFactory;
    const clock = options?.ports?.clock ?? this.defaultPorts?.clock ?? now;

    if (!corpusLoader) {
      throw new Error("EvaluateRequirementsCompilerUseCase: 'corpusLoader' port must be provided.");
    }
    if (!fixtureRepositoryFactory) {
      throw new Error(
        "EvaluateRequirementsCompilerUseCase: 'fixtureRepositoryFactory' port must be provided."
      );
    }
    if (!gatewayFactory) {
      throw new Error(
        "EvaluateRequirementsCompilerUseCase: 'gatewayFactory' port must be provided."
      );
    }

    const manifestPath = options?.manifestPath;
    const corpus: LoadedCorpus = corpusLoader(manifestPath);
    const corpusIdentityResult = computeCorpusIdentity(corpus);

    const runId = `EVAL-${randomUUID()}`;
    const executedAt = clock();

    const candidateShaValue = options?.candidateSha ?? process.env.CANDIDATE_SHA;
    const candidateSha: AvailableValueDto<string> = candidateShaValue
      ? { status: 'available', value: candidateShaValue }
      : {
          status: 'unavailable',
          reason: 'Candidate SHA was not provided via options or CANDIDATE_SHA environment variable'
        };

    const providerMode = options?.provider ?? 'fixture-replay';
    const providerName = options?.providerName ?? providerMode;

    const baseStoreDir =
      options?.storeDir ?? path.join(os.tmpdir(), `solutions-studio-eval-${runId}`);
    await fs.mkdir(baseStoreDir, { recursive: true });

    const fixtureResults: EvaluationFixtureResultDto[] = [];
    const fixtureOrder: string[] = [];
    const declaredFixtures: DeclaredFixtureDeclarationDto[] = [];

    // Pre-populate declared fixtures metadata
    for (const entry of corpus.manifest.fixtures) {
      fixtureOrder.push(entry.fixtureId);
      const loaded = corpus.fixtures.get(entry.fixtureId);
      if (!loaded) {
        throw new Error(
          `Manifest entry fixture '${entry.fixtureId}' was not found in loaded corpus`
        );
      }
      declaredFixtures.push({
        fixtureId: loaded.fixture.fixtureId,
        expectedJsonHash: loaded.expectedJsonHash,
        sources: loaded.fixture.sources.map((s) => ({
          sourceRevisionId: s.sourceRevisionId,
          sourceId: s.sourceId,
          sourceType: s.sourceType,
          revision: s.revision,
          contentHash: loaded.sourceRevisions.get(s.sourceRevisionId)?.contentHash ?? '',
          supersedes: s.supersedes
        }))
      });
    }

    // Process each fixture in declared manifest order
    for (const entry of corpus.manifest.fixtures) {
      const fixtureId = entry.fixtureId;
      // Strict fixtureId format validation to prevent path traversal
      SafeFixtureIdSchema.parse(fixtureId);

      const loaded = corpus.fixtures.get(fixtureId);
      if (!loaded) {
        throw new Error(`Fixture '${fixtureId}' declared in manifest was not loaded`);
      }

      const fixtureStoreDir = path.resolve(baseStoreDir, 'fixtures', fixtureId);
      const relativeToStore = path.relative(baseStoreDir, fixtureStoreDir);
      if (relativeToStore.startsWith('..') || path.isAbsolute(relativeToStore)) {
        throw new Error(
          `Fixture store directory '${fixtureStoreDir}' escapes base store directory '${baseStoreDir}'`
        );
      }
      await fs.mkdir(fixtureStoreDir, { recursive: true });
      const fixtureRepo = await fixtureRepositoryFactory(fixtureStoreDir, fixtureId);

      let lineageMap: SourceLineageMap | undefined = undefined;
      let phase: 'capture' | 'compile' | 'scoring' = 'capture';

      try {
        // Step 1: Capture sources in declared order
        const capturedRecords: SourceRevisionRecord[] = [];
        for (const sourceDef of loaded.fixture.sources) {
          const sourceRev = loaded.sourceRevisions.get(sourceDef.sourceRevisionId);
          if (!sourceRev) {
            throw new Error(
              `Source revision '${sourceDef.sourceRevisionId}' declared in fixture '${fixtureId}' not loaded`
            );
          }

          const record = await fixtureRepo.captureSourceRevision({
            sourceId: createSourceId(sourceDef.sourceId),
            sourceType: sourceDef.sourceType,
            markdownText: sourceRev.text,
            capturedAt: executedAt
          });
          capturedRecords.push(record);
        }

        // Step 2: Validate lineage with content hashes
        const declaredContentHashes = new Map<string, string>();
        for (const [id, s] of loaded.sourceRevisions) {
          declaredContentHashes.set(id, s.contentHash);
        }
        lineageMap = validateSourceLineage(
          loaded.fixture.sources,
          capturedRecords,
          declaredContentHashes
        );

        // Step 3: Configure Generation Gateway via port factory
        phase = 'compile';
        const gateway = await gatewayFactory({
          fixtureId,
          fixture: loaded.fixture,
          lineageMap,
          capturedRecords
        });

        // Step 4: Invoke CompileRequirementsUseCase
        const compiler = new CompileRequirementsUseCase(gateway, fixtureRepo);
        const startTime = Date.now();
        const compileResult = await compiler.compile({
          sourceRevisionIds: capturedRecords.map((r) => r.revision.id)
        });
        const durationMs = Date.now() - startTime;

        // Step 5: Score structural observations
        phase = 'scoring';
        const groundTruth = normalizeExpectedGroundTruth(loaded.fixture, lineageMap);

        const observedRequirements: RequirementRevision[] = [];
        for (const reqRevId of compileResult.acceptedRequirementRevisions) {
          const reqRev = await fixtureRepo.getRequirementRevision(reqRevId);
          if (reqRev) {
            observedRequirements.push(reqRev);
          }
        }

        const observedFindings: CandidateFinding[] = [];
        for (const findingId of compileResult.acceptedFindingIds) {
          const finding = await fixtureRepo.getCandidateFinding(findingId);
          if (finding) {
            observedFindings.push(finding);
          }
        }

        const score = scoreFixture({
          groundTruth,
          observedRequirements,
          observedFindings,
          rejectedRequirements: compileResult.rejectedRequirements,
          rejectedFindings: compileResult.rejectedFindings,
          rawFindings: compileResult.rawResponse?.findings
        });

        const providerMetadata: AvailableValueDto<GenerationMetadataDto> =
          compileResult.generationMetadata
            ? {
                status: 'available',
                value: {
                  provider: compileResult.generationMetadata.provider,
                  model: compileResult.generationMetadata.model,
                  durationMs: compileResult.generationMetadata.durationMs,
                  tokens: compileResult.generationMetadata.tokens,
                  raw: compileResult.generationMetadata.raw
                }
              }
            : {
                status: 'unavailable',
                reason: 'Generation provider did not return runtime execution metadata'
              };

        fixtureResults.push({
          fixtureId,
          status: 'completed',
          sourceLineageMap: [...lineageMap.entries],
          executed: {
            capturedSourceRevisionIds: capturedRecords.map((r) => r.revision.id),
            inputSourceRevisionIds: capturedRecords.map((r) => r.revision.id),
            acceptedRequirementRevisions: [...compileResult.acceptedRequirementRevisions],
            acceptedFindingIds: [...compileResult.acceptedFindingIds],
            acceptedRequirementCount: compileResult.acceptedRequirementRevisions.length,
            rejectedRequirementCount: compileResult.rejectedRequirements.length,
            acceptedFindingCount: compileResult.acceptedFindingIds.length,
            rejectedFindingCount: compileResult.rejectedFindings.length,
            rawResponse: compileResult.rawResponse,
            providerMetadata
          },
          measured: {
            durationMs,
            score
          }
        });
      } catch (err) {
        const sanitizedError = sanitizeFailureEvidence(err, phase);
        fixtureResults.push({
          fixtureId,
          status: 'failed',
          sourceLineageMap: lineageMap ? [...lineageMap.entries] : undefined,
          error: sanitizedError
        });
      }
    }

    const aggregateScores = aggregateEvaluationScores(fixtureResults);

    const outputReportPath = options?.outputReportPath;
    const outputMarkdownPath = options?.outputMarkdownPath;

    const initialReport: EvaluationReportDto = {
      reportSchemaVersion: EVALUATION_REPORT_SCHEMA_VERSION,
      runId,
      executedAt,
      corpusVersion: corpus.manifest.corpusVersion,
      corpusIdentity: corpusIdentityResult.corpusIdentity,
      candidateSha,
      fixtureOrder,
      fixtureResults,
      aggregateScores,
      reportArtifacts: {
        jsonReportPath: outputReportPath
          ? { status: 'available', value: outputReportPath }
          : { status: 'unavailable', reason: 'outputReportPath was not requested' },
        jsonReportDigest: outputReportPath
          ? { status: 'available', value: '' }
          : { status: 'unavailable', reason: 'outputReportPath was not requested' },
        markdownReportPath: outputMarkdownPath
          ? { status: 'available', value: outputMarkdownPath }
          : { status: 'unavailable', reason: 'outputMarkdownPath was not requested' },
        markdownReportDigest: outputMarkdownPath
          ? { status: 'available', value: '' }
          : { status: 'unavailable', reason: 'outputMarkdownPath was not requested' }
      },
      provenance: {
        requested: {
          candidateSha,
          providerMode,
          providerName,
          manifestPath: corpus.manifestPath,
          outputReportPath: outputReportPath
            ? { status: 'available', value: outputReportPath }
            : { status: 'unavailable', reason: 'outputReportPath was not requested' },
          storeDir: options?.storeDir
            ? { status: 'available', value: options.storeDir }
            : { status: 'unavailable', reason: 'storeDir defaulted to temporary directory' }
        },
        declared: {
          manifestVersion: corpus.manifest.corpusVersion,
          manifestHash: corpusIdentityResult.manifestHash,
          canonicalizationVersion: corpusIdentityResult.canonicalizationVersion,
          corpusIdentity: corpusIdentityResult.corpusIdentity,
          fixtureOrder,
          fixtures: declaredFixtures
        },
        configured: {
          compilerVersion: COMPILER_VERSION,
          promptVersion: PROMPT_VERSION,
          gatewayConfig: { provider: providerMode, ...(options?.gatewayConfig ?? {}) },
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch
        },
        verified: {
          schemaValidation: true,
          corpusLineageValid: true,
          persistenceVerified: Boolean(options?.repository),
          reportDigest: ''
        }
      }
    };

    // Render human report and compute its digest if requested
    const humanReport = renderHumanReport(initialReport);
    if (outputMarkdownPath) {
      const mdDigest = crypto.createHash('sha256').update(humanReport).digest('hex');
      initialReport.reportArtifacts.markdownReportDigest = {
        status: 'available',
        value: mdDigest
      };
    }

    // Compute canonical report digest (with self-referential reportDigest and jsonReportDigest blanked)
    const canonicalReportString = canonicalizeReportForDigest(initialReport);
    const canonicalDigest = crypto.createHash('sha256').update(canonicalReportString).digest('hex');
    initialReport.provenance.verified.reportDigest = canonicalDigest;
    if (outputReportPath) {
      initialReport.reportArtifacts.jsonReportDigest = {
        status: 'available',
        value: canonicalDigest
      };
    }

    // Parse and validate full schema invariants
    const report = EvaluationReportSchema.parse(initialReport);

    const runRecord: EvaluationRunRecord = {
      id: runId,
      corpusVersion: corpus.manifest.corpusVersion,
      executedAt,
      fixtureResults: report.fixtureResults,
      report
    };

    // Save exclusively to repository if provided and verify reload (no double-save)
    if (options?.repository) {
      await options.repository.saveEvaluationRun(runRecord);
      const reloaded = await options.repository.getEvaluationRun(runId);
      if (!reloaded) {
        throw new Error(
          `Persistence verification failed: evaluation run '${runId}' could not be reloaded`
        );
      }
      if (
        reloaded.id !== runRecord.id ||
        reloaded.report.provenance.verified.reportDigest !== canonicalDigest ||
        JSON.stringify(reloaded.report) !== JSON.stringify(runRecord.report)
      ) {
        throw new Error(
          `Persistence verification failed: reloaded record does not match saved run`
        );
      }
    }

    // Save artifacts if requested
    if (outputReportPath) {
      await fs.mkdir(path.dirname(outputReportPath), { recursive: true });
      const jsonContent = renderJsonReport(report);
      await fs.writeFile(outputReportPath, jsonContent, 'utf8');
    }

    if (outputMarkdownPath) {
      await fs.mkdir(path.dirname(outputMarkdownPath), { recursive: true });
      await fs.writeFile(outputMarkdownPath, humanReport, 'utf8');
    }

    const success = aggregateScores.failedFixtures === 0;

    return {
      runRecord,
      report,
      humanReport,
      success
    };
  }
}
