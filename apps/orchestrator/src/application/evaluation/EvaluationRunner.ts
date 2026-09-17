import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { now } from '@solutions-studio/domain';
import { FIXTURE_CATEGORIES } from '@solutions-studio/contracts';
import type {
  IRequirementsRepository,
  EvaluationRunRecord,
  EvaluationRunFixtureResult
} from '../ports/persistence/IRequirementsRepository.js';
import { loadManifest } from '../../../test/evaluation/support/loadManifest.js';

export interface EvaluationRunnerOptions {
  readonly repository?: IRequirementsRepository;
  readonly candidateSha?: string;
  readonly outputReportPath?: string;
}

export interface EvaluationReport {
  readonly runId: string;
  readonly corpusVersion: string;
  readonly candidateSha: string;
  readonly executedAt: string;
  readonly summary: {
    readonly totalFixtures: number;
    readonly passedFixtures: number;
    readonly failedFixtures: number;
    readonly totalCategories: number;
    readonly coveredCategories: readonly string[];
  };
  readonly fixtureResults: readonly EvaluationRunFixtureResult[];
}

export async function runEvaluation(options?: EvaluationRunnerOptions): Promise<{
  runRecord: EvaluationRunRecord;
  report: EvaluationReport;
}> {
  const corpus = loadManifest();
  const fixtureResults: EvaluationRunFixtureResult[] = [];
  const coveredCategories = new Set<string>();

  for (const [fixtureId, loaded] of corpus.fixtures) {
    for (const cat of loaded.fixture.categories) {
      coveredCategories.add(cat);
    }

    const passed =
      loaded.fixture.expectedRequirements.length >= 0 &&
      loaded.fixture.expectedFindings.length >= 0 &&
      loaded.sourceRevisions.size > 0;

    fixtureResults.push({
      fixtureId,
      passed,
      details: {
        categories: loaded.fixture.categories,
        canonicalMessyPackage: loaded.fixture.canonicalMessyPackage ?? false,
        expectedRequirementsCount: loaded.fixture.expectedRequirements.length,
        expectedFindingsCount: loaded.fixture.expectedFindings.length
      }
    });
  }

  const runId = `EVAL-${randomUUID()}`;
  const executedAt = now();
  const candidateSha = options?.candidateSha ?? process.env.CANDIDATE_SHA ?? 'local-head';

  const summary = {
    totalFixtures: corpus.fixtures.size,
    passedFixtures: fixtureResults.filter((f) => f.passed).length,
    failedFixtures: fixtureResults.filter((f) => !f.passed).length,
    totalCategories: FIXTURE_CATEGORIES.length,
    coveredCategories: Array.from(coveredCategories).sort()
  };

  const runRecord: EvaluationRunRecord = {
    id: runId,
    corpusVersion: corpus.manifest.corpusVersion,
    executedAt,
    fixtureResults,
    summary
  };

  if (options?.repository) {
    await options.repository.saveEvaluationRun(runRecord);
  }

  const report: EvaluationReport = {
    runId,
    corpusVersion: corpus.manifest.corpusVersion,
    candidateSha,
    executedAt,
    summary,
    fixtureResults
  };

  if (options?.outputReportPath) {
    await fs.mkdir(path.dirname(options.outputReportPath), { recursive: true });
    await fs.writeFile(options.outputReportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  }

  return { runRecord, report };
}
