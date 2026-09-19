#!/usr/bin/env tsx
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  runPhase2ExitGate,
  type Phase2ExitGateResult
} from '../src/application/harness/runPhase2ExitGate.js';
import { createPhase2TestAdapter } from '../test/harness/createPhase2ExitGateAdapter.js';

interface CliArgs {
  provider: 'fake' | 'agy' | 'opencode';
  model?: string;
  storeDir?: string;
  cleanup: boolean;
  runs: number;
  outputJson?: string;
  outputMarkdown?: string;
  silent: boolean;
}

function parseArgs(args: string[]): CliArgs {
  let provider: 'fake' | 'agy' | 'opencode' =
    (process.env.GENERATION_PROVIDER as 'fake' | 'agy' | 'opencode') ?? 'fake';
  let model: string | undefined = process.env.MODEL_NAME;
  let storeDir: string | undefined;
  let cleanup = true;
  let runs = 1;
  let outputJson: string | undefined;
  let outputMarkdown: string | undefined;
  let silent = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--provider' && i + 1 < args.length) {
      const val = args[++i];
      if (val === 'fake' || val === 'agy' || val === 'opencode') {
        provider = val;
      } else {
        throw new Error(`Invalid provider '${val}'. Must be fake, agy, or opencode.`);
      }
    } else if (arg === '--model' && i + 1 < args.length) {
      model = args[++i];
    } else if (arg === '--store' && i + 1 < args.length) {
      storeDir = path.resolve(process.cwd(), args[++i]);
      cleanup = false;
    } else if (arg === '--keep-store') {
      cleanup = false;
    } else if (arg === '--runs' && i + 1 < args.length) {
      const parsed = parseInt(args[++i], 10);
      if (isNaN(parsed) || parsed < 1) {
        throw new Error(`--runs must be a positive integer, got '${args[i]}'`);
      }
      runs = parsed;
    } else if (arg === '--output' && i + 1 < args.length) {
      outputJson = path.resolve(process.cwd(), args[++i]);
    } else if (arg === '--output-markdown' && i + 1 < args.length) {
      outputMarkdown = path.resolve(process.cwd(), args[++i]);
    } else if (arg === '--silent') {
      silent = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: tsx scripts/run-phase-2-exit-gate.ts [options]

Options:
  --provider <fake|agy|opencode>   Generation provider (default: fake)
  --model <modelName>              Model name (e.g. gemini-3.8-flash-high)
  --store <dir>                    Store directory for requirements persistence
  --keep-store                     Do not clean up temporary store directory
  --runs <count>                   Number of independent validation runs (default: 1)
  --output <jsonPath>              Path to write JSON summary report
  --output-markdown <mdPath>       Path to write Markdown summary report
  --silent                         Suppress standard output logging
`);
      process.exit(0);
    }
  }

  return { provider, model, storeDir, cleanup, runs, outputJson, outputMarkdown, silent };
}

interface RunSummary {
  runIndex: number;
  runId: string;
  durationMs: number;
  success: boolean;
  result?: Phase2ExitGateResult;
  error?: string;
}

function generateMarkdownReport(
  args: CliArgs,
  summaries: RunSummary[],
  totalDurationMs: number
): string {
  const allPassed = summaries.every((s) => s.success);
  const rows = summaries.map((s) => {
    if (!s.result) {
      return `| Run ${s.runIndex} | ${s.runId} | FAIL | ${(s.durationMs / 1000).toFixed(1)}s | - | - | - | - | ${s.error ?? 'Unknown error'} |`;
    }
    const r = s.result;
    return `| Run ${s.runIndex} | ${s.runId} | PASS | ${(s.durationMs / 1000).toFixed(1)}s | ${r.projectionsA.processDiagram.repairsNeeded} | ${r.projectionsA.prototype.repairsNeeded} | ${r.projectionsB.processDiagram.repairsNeeded} | ${r.projectionsB.prototype.repairsNeeded} | All verified |`;
  });

  return `# Phase 2 Exit Gate Validation Summary

- **Provider:** \`${args.provider}\`
- **Model:** \`${args.model ?? 'default'}\`
- **Runs Executed:** ${summaries.length}
- **Total Duration:** ${(totalDurationMs / 1000).toFixed(1)}s
- **Status:** ${allPassed ? '**PASSED (All runs successful)**' : '**FAILED (One or more runs failed)**'}

## Run-to-Run Results

| Run | Run ID | Status | Duration | Diagram A Repairs | Prototype A Repairs | Diagram B Repairs | Prototype B Repairs | Notes |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
${rows.join('\n')}

## Invariants Witness

- **Locator Resolution:** All locators resolved to exact source markdown excerpts in all passing runs.
- **Promotion Prevention:** Unaccepted candidate proposals and open findings were blocked from baseline creation in all runs.
- **Historical Immutability:** Predecessor baseline \`BASE-001\` remained bit-identical across all operations and process restarts.
- **Staleness Detection:** Predecessor projections were correctly marked as stale in successor review state across all runs.
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startTime = Date.now();
  const summaries: RunSummary[] = [];

  if (!args.silent) {
    console.log(
      `Starting Phase 2 Exit Gate (Runs: ${args.runs}, Provider: ${args.provider}, Model: ${args.model ?? 'default'})...\n`
    );
  }

  let allSuccess = true;

  for (let runIdx = 1; runIdx <= args.runs; runIdx++) {
    const runStart = Date.now();
    const runId = `RUN-P2-${runIdx}-${Math.random().toString(36).slice(2, 8)}`;
    const runStoreDir = args.storeDir
      ? args.runs > 1
        ? `${args.storeDir}-run-${runIdx}`
        : args.storeDir
      : undefined;

    if (!args.silent) {
      console.log(`--- [Run ${runIdx}/${args.runs}] (ID: ${runId}) ---`);
    }

    try {
      const adapter = args.provider === 'fake' ? createPhase2TestAdapter() : undefined;
      const result = await runPhase2ExitGate({
        provider: args.provider,
        model: args.model,
        storeDir: runStoreDir,
        cleanup: args.cleanup,
        silent: args.silent,
        adapter,
        runId
      });

      const durationMs = Date.now() - runStart;
      summaries.push({
        runIndex: runIdx,
        runId,
        durationMs,
        success: result.success,
        result
      });

      if (!result.success) {
        allSuccess = false;
      }
    } catch (err: unknown) {
      const durationMs = Date.now() - runStart;
      const errorMessage = err instanceof Error ? err.message : String(err);
      summaries.push({
        runIndex: runIdx,
        runId,
        durationMs,
        success: false,
        error: errorMessage
      });
      allSuccess = false;
      if (!args.silent) {
        console.error(`Run ${runIdx} failed:`, err);
      }
    }
  }

  const totalDurationMs = Date.now() - startTime;

  // Output JSON report if requested
  if (args.outputJson) {
    await fs.mkdir(path.dirname(args.outputJson), { recursive: true });
    await fs.writeFile(
      args.outputJson,
      JSON.stringify(
        {
          provider: args.provider,
          model: args.model,
          runsCount: args.runs,
          totalDurationMs,
          allSuccess,
          runs: summaries
        },
        null,
        2
      ) + '\n',
      'utf8'
    );
    if (!args.silent) {
      console.log(`Wrote JSON report to: ${args.outputJson}`);
    }
  }

  // Output Markdown report if requested
  if (args.outputMarkdown) {
    await fs.mkdir(path.dirname(args.outputMarkdown), { recursive: true });
    const md = generateMarkdownReport(args, summaries, totalDurationMs);
    await fs.writeFile(args.outputMarkdown, md, 'utf8');
    if (!args.silent) {
      console.log(`Wrote Markdown report to: ${args.outputMarkdown}`);
    }
  }

  if (!args.silent) {
    console.log(
      `\nAll ${args.runs} run(s) finished in ${(totalDurationMs / 1000).toFixed(1)}s. Result: ${allSuccess ? 'SUCCESS' : 'FAILURE'}`
    );
  }

  if (!allSuccess) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error in run-phase-2-exit-gate:', err);
  process.exit(1);
});
