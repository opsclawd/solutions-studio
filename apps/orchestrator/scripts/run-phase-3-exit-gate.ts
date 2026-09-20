#!/usr/bin/env tsx
import path from 'node:path';
import fs from 'node:fs/promises';
import cp from 'node:child_process';
import {
  runPhase3ExitGate,
  type Phase3ExitGateResult
} from '../src/application/harness/runPhase3ExitGate.js';
import { createPhase3TestAdapter } from '../test/harness/createPhase3ExitGateAdapter.js';

export interface CliArgs {
  provider: 'fake' | 'agy' | 'opencode';
  model?: string;
  storeDir?: string;
  cleanup: boolean;
  runs: number;
  outputJson?: string;
  outputMarkdown?: string;
  silent: boolean;
}

export function parseArgs(args: string[]): CliArgs {
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
    } else if ((arg === '--output' || arg === '--json') && i + 1 < args.length) {
      outputJson = path.resolve(process.cwd(), args[++i]);
    } else if ((arg === '--output-markdown' || arg === '--report') && i + 1 < args.length) {
      outputMarkdown = path.resolve(process.cwd(), args[++i]);
    } else if (arg === '--silent') {
      silent = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: tsx scripts/run-phase-3-exit-gate.ts [options]

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

  if (provider !== 'fake' && (!model || model.trim().length === 0)) {
    throw new Error(`--model <modelName> is required when provider is '${provider}'`);
  }

  return { provider, model, storeDir, cleanup, runs, outputJson, outputMarkdown, silent };
}

export interface RunSummary {
  runIndex: number;
  runId: string;
  durationMs: number;
  success: boolean;
  result?: Phase3ExitGateResult;
  error?: string;
}

export function generateMarkdownReport(
  args: CliArgs,
  summaries: RunSummary[],
  totalDurationMs: number
): string {
  const allPassed = summaries.length > 0 && summaries.every((s) => s.success);
  const rows = summaries.map((s) => {
    if (!s.result) {
      return `| Run ${s.runIndex} | ${s.runId} | FAIL | ${(s.durationMs / 1000).toFixed(1)}s | - | - | - | - | - | - | - | - | - | - | - | - | ${s.error ?? 'Unknown error'} |`;
    }
    const r = s.result;
    const status = s.success ? 'PASS' : 'FAIL';
    const covPercent = `${((r.coverageOutcome.coveredCount / r.coverageOutcome.totalRequirements) * 100).toFixed(0)}%`;
    const covStr = `${covPercent} (${r.coverageOutcome.coveredCount}/${r.coverageOutcome.totalRequirements})`;
    const readinessTotal =
      r.finalReadinessOutcome.readyCount + r.finalReadinessOutcome.nonReadyCount;
    const readinessStr = `${r.finalReadinessOutcome.readyCount}/${readinessTotal}`;
    const acyclicStr =
      r.dependencyGraphOutcome.isAcyclic && r.dependencyGraphOutcome.isValid ? 'Yes' : 'No';
    const handoffStr = r.handoffBundle.isHandoffReady ? 'Ready' : 'Not Ready';
    const hashesStr = r.handoffBundle.contentHashesVerified ? 'Verified' : 'Failed';
    const notes = s.success
      ? `All verified (${r.immutabilityVerification.snapshotCount} predecessor snapshots verified across separate process PID ${r.immutabilityVerification.reloadedProcessPid})`
      : (s.error ?? 'Run failed');

    return `| Run ${s.runIndex} | ${s.runId} | ${status} | ${(s.durationMs / 1000).toFixed(1)}s | ${r.sqlValidationOutcome.repairsNeededA} | ${r.openApiValidationOutcome.repairsNeededA} | ${r.sqlValidationOutcome.repairsNeededB} | ${r.openApiValidationOutcome.repairsNeededB} | ${r.storiesOutcome.repairsNeededStory1} | ${r.storiesOutcome.repairsNeededStory2} | ${r.storiesOutcome.count} | ${covStr} | ${readinessStr} | ${acyclicStr} | ${handoffStr} | ${hashesStr} | ${notes} |`;
  });

  const invariantsSection = allPassed
    ? `## Invariants Witness

- **Authority Separation:** Legitimate technical choices recorded as EngineeringDecisions (\`ED-001\` on \`BASE-001\`, \`ED-002\` on \`BASE-002\` superseding \`ED-001\`), not conflated with business requirements.
- **Fail-Closed Readiness Gate:** Product ambiguity (\`FIND-001: incomplete-state-machine\` in \`OPEN\` disposition) strictly failed candidate story readiness closed via Rule 5 (\`no-blocking-open-findings\`), and handoff bundle reported \`isHandoffReady: false\`.
- **Human Reconciliation Workflow:** Product ambiguity cleared via authorized human reconciliation; requirement revision progressed through complete lineage (\`REQ-ORD-01-R1\` -> \`R2\` -> \`R3\` -> \`R4\`, \`ACCEPTED\`/\`CLEAR\`).
- **Successor Contract Regeneration:** Successor baseline \`BASE-002\` cleanly bound to resolved requirement revision and policy constraint; SQL DDL and OpenAPI 3.1.0 specifications validated against \`BASE-002\` and \`ED-002\`.
- **Isolated PostgreSQL Runtime:** Relational DDL successfully validated in isolated PostgreSQL runtime (PGlite WASM).
- **Structural OpenAPI 3.1.0 & Cross-Validation:** OpenAPI 3.1.0 contracts structurally verified and cross-validated with relational database schemas.
- **Deterministic Coverage & Readiness:** Measured 100% requirement coverage and 100% story readiness.
- **Acyclic Dependency Graph:** Machine-readable story dependency graph built with valid topological ordering.
- **Implementation-Ready Handoff:** Complete engineering handoff bundle verified with cryptographic SHA-256 content hashes for SQL, OpenAPI, and both story projections.
- **Historical Immutability & Process-Restart Durability:** Predecessor baseline \`BASE-001\`, \`ED-001\`, candidate story, and predecessor projections verified bit-identical across separate child process reload.
`
    : `## Invariants Witness

> [!WARNING]
> Invariants NOT certified: One or more validation runs failed.
`;

  return `# Phase 3 Exit Gate Validation Summary

- **Provider:** \`${args.provider}\`
- **Model:** \`${args.model ?? 'default'}\`
- **Runs Executed:** ${summaries.length}
- **Total Duration:** ${(totalDurationMs / 1000).toFixed(1)}s
- **Status:** ${allPassed ? '**PASSED (All runs successful)**' : '**FAILED (One or more runs failed)**'}

## Run-to-Run Results

| Run | Run ID | Status | Duration | SQL A Repairs | OAS A Repairs | SQL B Repairs | OAS B Repairs | Story 1 Repairs | Story 2 Repairs | Stories Count | Coverage | Readiness | Graph Acyclic | Handoff Ready | Hashes | Notes |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
${rows.join('\n')}

${invariantsSection}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startTime = Date.now();
  const summaries: RunSummary[] = [];

  let gitHeadSha: string | undefined;
  if (args.provider !== 'fake') {
    try {
      gitHeadSha = cp.execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
      cp.execSync(`git cat-file -e ${gitHeadSha}^{commit}`);
      const gitStatus = cp.execSync('git status --porcelain', { encoding: 'utf8' }).trim();
      if (gitStatus.length > 0) {
        console.error(`Cannot run real-provider validation: worktree is dirty:\n${gitStatus}`);
        process.exit(1);
      }
    } catch (err) {
      console.error(`Git clean checkout verification failed: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  if (!args.silent) {
    console.log(
      `Starting Phase 3 Exit Gate (Runs: ${args.runs}, Provider: ${args.provider}, Model: ${args.model ?? 'default'})...\n`
    );
  }

  let allSuccess = true;

  for (let runIdx = 1; runIdx <= args.runs; runIdx++) {
    const runStart = Date.now();
    const runId = `RUN-P3-${runIdx}-${Math.random().toString(36).slice(2, 8)}`;
    const runStoreDir = args.storeDir
      ? args.runs > 1
        ? `${args.storeDir}-run-${runIdx}`
        : args.storeDir
      : undefined;

    if (!args.silent) {
      console.log(`--- [Run ${runIdx}/${args.runs}] (ID: ${runId}) ---`);
    }

    try {
      const adapter = args.provider === 'fake' ? createPhase3TestAdapter() : undefined;
      const result = await runPhase3ExitGate({
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
          gitHeadSha,
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

const isCli =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('run-phase-3-exit-gate.ts') ||
    process.argv[1].endsWith('run-phase-3-exit-gate.js'));

if (isCli) {
  main().catch((err) => {
    console.error('Fatal error in run-phase-3-exit-gate:', err);
    process.exit(1);
  });
}
