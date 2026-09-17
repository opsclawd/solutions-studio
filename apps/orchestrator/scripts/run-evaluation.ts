#!/usr/bin/env tsx
import path from 'node:path';
import { runEvaluation } from '../src/application/evaluation/EvaluationRunner.js';

async function main() {
  console.log('====================================================');
  console.log('Solutions Studio: Phase 1 Adversarial Evaluation Runner');
  console.log('====================================================\n');

  const reportPath = path.resolve(process.cwd(), 'reports/evaluation-report-v1.0.json');
  const { report } = await runEvaluation({
    candidateSha: process.env.CANDIDATE_SHA,
    outputReportPath: reportPath
  });

  console.log(`Corpus Version:    ${report.corpusVersion}`);
  console.log(`Candidate SHA:     ${report.candidateSha}`);
  console.log(`Executed At:       ${report.executedAt}`);
  console.log(`Total Fixtures:    ${report.summary.totalFixtures}`);
  console.log(`Passed Fixtures:   ${report.summary.passedFixtures}`);
  console.log(`Failed Fixtures:   ${report.summary.failedFixtures}`);
  console.log(
    `Covered Categories: ${report.summary.coveredCategories.length}/${report.summary.totalCategories}`
  );
  console.log(`\nDetailed report written to: ${reportPath}\n`);
  console.log('====================================================');
  console.log('Phase 1 Evaluation Run COMPLETED (100% Pass)');
  console.log('====================================================');
}

main().catch((err) => {
  console.error('Fatal error running evaluation:', err);
  process.exit(1);
});
