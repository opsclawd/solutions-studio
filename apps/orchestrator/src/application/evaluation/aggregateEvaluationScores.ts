import { REQUIREMENT_CATEGORIES, type RequirementCategory } from '@solutions-studio/domain';
import {
  FIXTURE_CATEGORIES,
  type FixtureCategoryDto,
  type EvaluationFixtureResultDto,
  type AggregateCategoryScoresDto,
  type ScoreCountersDto,
  type RollupMetricDto
} from '@solutions-studio/contracts';

function computeScoreCounters(tp: number, fp: number, fn: number): ScoreCountersDto {
  const precision = tp + fp === 0 ? null : tp / (tp + fp);
  const recall = tp + fn === 0 ? null : tp / (tp + fn);
  const f1Score =
    precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : null;

  return {
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    precision,
    recall,
    f1Score
  };
}

export function aggregateEvaluationScores(
  fixtureResults: readonly EvaluationFixtureResultDto[]
): AggregateCategoryScoresDto {
  const totalFixtures = fixtureResults.length;
  const completedFixtures = fixtureResults.filter(
    (f): f is Extract<EvaluationFixtureResultDto, { status: 'completed' }> =>
      f.status === 'completed'
  );
  const failedFixtures = fixtureResults.filter((f) => f.status === 'failed');

  // Aggregate requirements by category
  const requirementsByCategory = {} as Record<RequirementCategory, ScoreCountersDto>;
  for (const cat of REQUIREMENT_CATEGORIES) {
    let tp = 0;
    let fp = 0;
    let fn = 0;

    for (const res of completedFixtures) {
      const counters = res.measured.score.requirementsByCategory[cat];
      if (counters) {
        tp += counters.truePositives;
        fp += counters.falsePositives;
        fn += counters.falseNegatives;
      }
    }

    requirementsByCategory[cat] = computeScoreCounters(tp, fp, fn);
  }

  // Aggregate findings by category
  const findingsByCategory = {} as Record<FixtureCategoryDto, ScoreCountersDto>;
  for (const cat of FIXTURE_CATEGORIES) {
    let tp = 0;
    let fp = 0;
    let fn = 0;

    for (const res of completedFixtures) {
      const counters = res.measured.score.findingsByCategory[cat];
      if (counters) {
        tp += counters.truePositives;
        fp += counters.falsePositives;
        fn += counters.falseNegatives;
      }
    }

    findingsByCategory[cat] = computeScoreCounters(tp, fp, fn);
  }

  // Aggregate unclassified findings
  let unclassifiedFindingsCount = 0;
  for (const res of completedFixtures) {
    unclassifiedFindingsCount += res.measured.score.unclassifiedFindingsCount;
  }

  // Optional rollups
  let totalDurationMs: RollupMetricDto | undefined = undefined;
  if (completedFixtures.length > 0) {
    const totalDuration = completedFixtures.reduce((sum, res) => sum + res.measured.durationMs, 0);
    totalDurationMs = {
      value: totalDuration,
      contributingCompletedFixtureCount: completedFixtures.length,
      unavailableFixtureCount: 0
    };
  }

  let totalTokens: RollupMetricDto | undefined = undefined;
  let tokenCount = 0;
  let contributingTokenFixtures = 0;

  for (const res of completedFixtures) {
    if (
      res.executed.providerMetadata.status === 'available' &&
      res.executed.providerMetadata.value.tokens?.total !== undefined
    ) {
      tokenCount += res.executed.providerMetadata.value.tokens.total;
      contributingTokenFixtures++;
    }
  }

  if (contributingTokenFixtures > 0) {
    totalTokens = {
      value: tokenCount,
      contributingCompletedFixtureCount: contributingTokenFixtures,
      unavailableFixtureCount: completedFixtures.length - contributingTokenFixtures
    };
  }

  return {
    totalFixtures,
    completedFixtures: completedFixtures.length,
    failedFixtures: failedFixtures.length,
    requirementsByCategory,
    findingsByCategory,
    unclassifiedFindingsCount,
    totalDurationMs,
    totalTokens
  };
}
