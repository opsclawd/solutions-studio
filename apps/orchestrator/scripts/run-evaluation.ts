#!/usr/bin/env tsx
import path from 'node:path';
import { FilesystemRequirementsRepository } from '../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { runEvaluation } from '../src/infrastructure/evaluation/runEvaluation.js';
import type {
  ProviderType,
  GatewayConfig
} from '../src/infrastructure/generation/GatewayFactory.js';
import { FIXTURE_CATEGORIES } from '@solutions-studio/contracts';

export interface CliArgs {
  provider: ProviderType;
  manifestPath?: string;
  storeDir?: string;
  outputReportPath?: string;
  outputMarkdownPath?: string;
  candidateSha?: string;
  timeoutMs?: number;
  agyBinPath?: string;
  opencodeBinPath?: string;
  modelName?: string;
}

const KNOWN_OPTIONS = new Set([
  '--provider',
  '--manifest',
  '--store',
  '--output',
  '--output-markdown',
  '--candidate-sha',
  '--timeout',
  '--agy-bin',
  '--opencode-bin',
  '--model'
]);

export function parseArgs(args: string[]): CliArgs {
  let provider: ProviderType =
    (process.env.GENERATION_PROVIDER as ProviderType) ?? 'fixture-replay';
  let manifestPath: string | undefined = undefined;
  let storeDir: string | undefined = undefined;
  let outputReportPath: string | undefined = path.resolve(
    process.cwd(),
    'reports/evaluation-report-v1.0.json'
  );
  let outputMarkdownPath: string | undefined = path.resolve(
    process.cwd(),
    'reports/evaluation-report-v1.0.md'
  );
  let candidateSha: string | undefined = process.env.CANDIDATE_SHA;
  let timeoutMs: number | undefined = undefined;
  let agyBinPath: string | undefined = process.env.AGY_BIN_PATH;
  let opencodeBinPath: string | undefined = process.env.OPENCODE_BIN_PATH;
  let modelName: string | undefined = undefined;

  const seenOptions = new Set<string>();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected positional argument: '${arg}'`);
    }

    if (!KNOWN_OPTIONS.has(arg)) {
      throw new Error(`Unknown option: '${arg}'`);
    }

    if (seenOptions.has(arg)) {
      throw new Error(`Duplicate option: '${arg}'`);
    }
    seenOptions.add(arg);

    if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
      throw new Error(`Option '${arg}' requires a value`);
    }

    const value = args[++i];

    switch (arg) {
      case '--provider':
        provider = value as ProviderType;
        break;
      case '--manifest':
        manifestPath = path.resolve(process.cwd(), value);
        break;
      case '--store':
        storeDir = path.resolve(process.cwd(), value);
        break;
      case '--output':
        outputReportPath = path.resolve(process.cwd(), value);
        break;
      case '--output-markdown':
        outputMarkdownPath = path.resolve(process.cwd(), value);
        break;
      case '--candidate-sha':
        candidateSha = value;
        break;
      case '--timeout': {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new Error(`Option '--timeout' must be a positive integer, received: '${value}'`);
        }
        timeoutMs = parsed;
        break;
      }
      case '--agy-bin':
        agyBinPath = path.resolve(process.cwd(), value);
        break;
      case '--opencode-bin':
        opencodeBinPath = path.resolve(process.cwd(), value);
        break;
      case '--model':
        modelName = value;
        break;
    }
  }

  const validProviders: ProviderType[] = ['fixture-replay', 'agy', 'opencode'];
  if (!validProviders.includes(provider)) {
    throw new Error(`Invalid provider '${provider}'. Allowed values: ${validProviders.join(', ')}`);
  }

  if (seenOptions.has('--agy-bin') && provider !== 'agy') {
    throw new Error(`Option '--agy-bin' is only valid when provider is 'agy', got '${provider}'`);
  }

  if (seenOptions.has('--opencode-bin') && provider !== 'opencode') {
    throw new Error(
      `Option '--opencode-bin' is only valid when provider is 'opencode', got '${provider}'`
    );
  }

  if (seenOptions.has('--model') && provider !== 'agy' && provider !== 'opencode') {
    throw new Error(
      `Option '--model' is only valid when provider is 'agy' or 'opencode', got '${provider}'`
    );
  }

  return {
    provider,
    manifestPath,
    storeDir,
    outputReportPath,
    outputMarkdownPath,
    candidateSha,
    timeoutMs,
    agyBinPath,
    opencodeBinPath,
    modelName
  };
}

export async function main() {
  console.log('====================================================');
  console.log('Solutions Studio: Requirements Intelligence Evaluation');
  console.log('====================================================\n');

  const cliArgs = parseArgs(process.argv.slice(2));

  const resolvedStoreDir = cliArgs.storeDir ?? path.resolve(process.cwd(), '.evaluation-store');
  const rootRepo = new FilesystemRequirementsRepository({ baseDir: resolvedStoreDir });

  const gatewayConfig: GatewayConfig = {
    provider: cliArgs.provider,
    timeoutMs: cliArgs.timeoutMs,
    agyBinPath: cliArgs.agyBinPath,
    opencodeBinPath: cliArgs.opencodeBinPath,
    model: cliArgs.modelName,
    cwd: process.cwd()
  };

  const { report, success } = await runEvaluation({
    repository: rootRepo,
    candidateSha: cliArgs.candidateSha,
    outputReportPath: cliArgs.outputReportPath,
    outputMarkdownPath: cliArgs.outputMarkdownPath,
    manifestPath: cliArgs.manifestPath,
    provider: cliArgs.provider,
    gatewayConfig,
    storeDir: path.join(resolvedStoreDir, 'fixtures')
  });

  console.log(`Run ID:              ${report.runId}`);
  console.log(`Corpus Version:      ${report.corpusVersion}`);
  console.log(`Corpus Identity:     ${report.corpusIdentity}`);
  console.log(
    `Candidate SHA:       ${report.candidateSha.status === 'available' ? report.candidateSha.value : '(unavailable)'}`
  );
  console.log(`Provider Mode:       ${report.provenance.requested.providerMode}`);
  console.log(`Executed At:         ${report.executedAt}`);
  console.log(`Total Fixtures:      ${report.aggregateScores.totalFixtures}`);
  console.log(`Completed Fixtures:  ${report.aggregateScores.completedFixtures}`);
  console.log(`Failed Fixtures:     ${report.aggregateScores.failedFixtures}`);
  if (report.aggregateScores.totalDurationMs) {
    console.log(`Elapsed Wall Time:   ${report.aggregateScores.totalDurationMs.value}ms`);
  }
  console.log('');

  console.log('Defect Finding Quality by Category:');
  console.log('----------------------------------------------------');
  for (const cat of FIXTURE_CATEGORIES) {
    const c = report.aggregateScores.findingsByCategory[cat];
    const prec =
      c?.precision !== null && c?.precision !== undefined
        ? `${(c.precision * 100).toFixed(1)}%`
        : 'N/A';
    const rec =
      c?.recall !== null && c?.recall !== undefined ? `${(c.recall * 100).toFixed(1)}%` : 'N/A';
    console.log(
      `  ${cat.padEnd(38)} TP: ${c?.truePositives ?? 0}  FP: ${c?.falsePositives ?? 0}  FN: ${c?.falseNegatives ?? 0}  (Prec: ${prec}, Rec: ${rec})`
    );
  }
  console.log('----------------------------------------------------');

  if (cliArgs.outputReportPath) {
    console.log(`\nMachine report written to:  ${cliArgs.outputReportPath}`);
  }
  if (cliArgs.outputMarkdownPath) {
    console.log(`Human report written to:    ${cliArgs.outputMarkdownPath}`);
  }

  console.log('\n====================================================');
  if (success) {
    console.log('Evaluation Run COMPLETED (All fixtures evaluated)');
  } else {
    console.log(
      `Evaluation Run COMPLETED WITH FAILURES (${report.aggregateScores.failedFixtures} fixture(s) failed)`
    );
  }
  console.log('====================================================');

  if (!success) {
    process.exit(1);
  }
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  (import.meta.url === `file://${path.resolve(process.argv[1])}` ||
    process.argv[1].endsWith('run-evaluation.ts') ||
    process.argv[1].endsWith('run-evaluation.js'));

if (isDirectRun) {
  main().catch((err) => {
    console.error('\nFatal error running evaluation:', err);
    process.exit(1);
  });
}
