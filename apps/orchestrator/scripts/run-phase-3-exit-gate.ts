#!/usr/bin/env tsx
import path from 'node:path';
import fs from 'node:fs/promises';
import cp from 'node:child_process';
import {
  runPhase3ExitGate,
  type Phase3ExitGateResult
} from '../src/application/harness/runPhase3ExitGate.js';
import { createPhase3TestAdapter } from '../test/harness/createPhase3ExitGateAdapter.js';
import type { ValidationRunRecord, CandidatePromotionStatus } from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import {
  RecordValidationRunUseCase,
  EvaluateCandidatePromotionStatusUseCase
} from '../src/application/use-cases/governance/index.js';

export interface CliArgs {
  provider: 'fake' | 'agy' | 'opencode';
  model?: string;
  storeDir?: string;
  cleanup: boolean;
  runs: number;
  outputJson?: string;
  outputMarkdown?: string;
  silent: boolean;
  candidateSha?: string;
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
  let candidateSha: string | undefined = process.env.CANDIDATE_SHA;

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
    } else if (arg === '--candidate-sha' && i + 1 < args.length) {
      candidateSha = args[++i];
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
  --candidate-sha <commitSha>      Candidate commit SHA to bind validation run to
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

  return {
    provider,
    model,
    storeDir,
    cleanup,
    runs,
    outputJson,
    outputMarkdown,
    silent,
    candidateSha
  };
}

export interface RunSummary {
  runIndex: number;
  runId: string;
  durationMs: number;
  success: boolean;
  result?: Phase3ExitGateResult;
  error?: string;
}

export interface GovernanceReportContext {
  readonly candidateSha?: string;
  readonly runRecord?: ValidationRunRecord;
  readonly promotionStatus?: CandidatePromotionStatus;
  readonly error?: string;
}

export function generateMarkdownReport(
  args: CliArgs,
  summaries: RunSummary[],
  totalDurationMs: number,
  governanceContext?: GovernanceReportContext
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

  let section12 = '';
  if (governanceContext) {
    const { candidateSha, runRecord, promotionStatus, error } = governanceContext;
    if (error) {
      section12 = `

---

## 12. Phase 3 Exit Decision Gate

### Human Disposition Gate

- [ ] **GO**
- [x] **DESIGN CHANGE** — Governance integrity failure: ${error}

### Audit Evidence & Attestation Status

- **Status:** \`GOVERNANCE_ERROR\` (FAILED_CLOSED)
- **Candidate Git Commit SHA:** \`${candidateSha ?? 'unresolved'}\`
- **Error:** ${error}

### Gate Result
Promotion gate failed closed because authoritative governance records could not be recorded or evaluated.
`;
    } else if (promotionStatus?.isApproved && promotionStatus.activeApproval) {
      const a = promotionStatus.activeApproval;
      section12 = `

---

## 12. Phase 3 Exit Decision Gate

### Human Disposition Gate

- [x] **GO** — Approved by ${a.actor.name} (${a.actor.id})
- [ ] **DESIGN CHANGE**

### Audit Evidence & Cryptographic Attestation

- **Candidate Git Commit SHA:** \`${candidateSha ?? a.candidateSha}\`
- **Validation Run ID:** \`${a.validationRunId}\`
- **Evidence Digest:** \`${a.evidenceDigest}\`
- **Signed By:** ${a.actor.name} (${a.actor.email ?? 'no email'}) [ID: ${a.actor.id}]
- **Reviewing Authority Role:** Human Reviewer (\`candidate:approve\`)
- **Signed At:** ${a.decidedAt}
- **Approval Record ID:** \`${a.id}\`
- **Reviewer Justification:**
  > ${a.rationale}
`;
    } else {
      const disp = promotionStatus?.disposition ?? 'UNAPPROVED';
      const diag = promotionStatus?.diagnosticCode ?? 'AWAITING_APPROVAL';
      const sha = candidateSha ?? 'uncommitted';
      const runId = runRecord?.id ?? summaries[0]?.runId ?? 'unknown';
      const digest = runRecord?.evidenceDigest ?? 'unknown';

      section12 = `

---

## 12. Phase 3 Exit Decision Gate

### Human Disposition Gate (Select Exactly One)

- [ ] **GO** — Approve the exact candidate SHA and proceed to release.
- [ ] **DESIGN CHANGE** — Reject the candidate SHA and append evidence-backed remediation issue(s).

### Audit Evidence & Attestation Status

- **Status:** \`${disp}\` (${diag})
- **Candidate Git Commit SHA:** \`${sha}\`
- **Validation Run ID:** \`${runId}\`
- **Evidence Digest:** \`${digest}\`

### Reviewer Instructions
To approve candidate promotion, an authorized human reviewer must execute:
\`\`\`bash
pnpm governance approve --sha ${sha} --run-id ${runId} --digest ${digest} --token <BEARER_TOKEN> --url <API_URL> --rationale "<Reviewer audit rationale>"
\`\`\`
Or approve via the Engineering Handoff UI: **Governance Audit** tab.
`;
    }
  } else {
    section12 = `

---

## 12. Phase 3 Exit Decision Gate

### Human Disposition Gate

- [ ] **GO**
- [x] **DESIGN CHANGE** — Governance evaluation missing or uninitialized

### Audit Evidence & Attestation Status

- **Status:** \`GOVERNANCE_ERROR\` (FAILED_CLOSED)
- **Candidate Git Commit SHA:** \`${args.candidateSha ?? 'unresolved'}\`
- **Error:** Authoritative governance records were not recorded or evaluated.

### Gate Result
Promotion gate failed closed because authoritative governance records could not be recorded or evaluated.
`;
  }

  return `# Phase 3 Exit Gate Validation Summary

- **Provider:** \`${args.provider}\`
- **Model:** \`${args.model ?? 'default'}\`
- **Runs Executed:** ${summaries.length}
- **Total Duration:** ${(totalDurationMs / 1000).toFixed(1)}s
- **Status:** ${allPassed ? '**PASSED (All runs successful)**' : '**FAILED (One or more runs failed)**'}

## Run-to-Run Results

| Run | Run ID | Status | Duration | SQL A Repairs | OAS A Repairs | SQL B Repairs | OAS B Repairs | Story 1 Repairs | Story 2 Repairs | Stories Count | Coverage | Readiness | Graph Acyclic | Handoff Ready | Hashes | Notes |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
${rows.join('\n')}

${invariantsSection}${section12}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startTime = Date.now();
  const summaries: RunSummary[] = [];

  let gitHeadSha: string | undefined = args.candidateSha;
  if (!gitHeadSha) {
    try {
      gitHeadSha = cp.execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch {
      // Ignored here; handled fail-closed below if still unassigned
    }
  }

  if (args.provider !== 'fake') {
    try {
      const resolvedSha = cp.execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
      cp.execSync(`git cat-file -e ${resolvedSha}^{commit}`);
      const gitStatus = cp.execSync('git status --porcelain', { encoding: 'utf8' }).trim();
      if (gitStatus.length > 0) {
        console.error(`Cannot run real-provider validation: worktree is dirty:\n${gitStatus}`);
        process.exit(1);
      }
      gitHeadSha = gitHeadSha ?? resolvedSha;
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

  let governanceContext: GovernanceReportContext | undefined;
  try {
    const storeBase = args.storeDir ?? path.resolve(process.cwd(), '.data/requirements');
    const repo = new FilesystemRequirementsRepository({ baseDir: storeBase });
    const effectiveSha = args.candidateSha ?? gitHeadSha;
    if (!effectiveSha) {
      throw new Error(
        'Candidate commit SHA could not be resolved from --candidate-sha or git HEAD. Fail closed.'
      );
    }

    const lastSuccessfulRun = summaries
      .slice()
      .reverse()
      .find((s) => s.success && s.result);

    if (lastSuccessfulRun?.result) {
      const r = lastSuccessfulRun.result;
      const recordUseCase = new RecordValidationRunUseCase(repo);
      const statusUseCase = new EvaluateCandidatePromotionStatusUseCase(repo);

      const runRecord = await recordUseCase.execute({
        candidateSha: effectiveSha,
        executedBy: 'cli:run-phase-3-exit-gate',
        phase: 'phase-3',
        executionMode: r.executionMode,
        provider: r.provider,
        model: r.model,
        artifacts: [
          {
            name: 'schema-ddl.sql',
            artifactType: 'sql-ddl',
            content: r.handoffBundle.contents?.sql,
            contentHash: r.handoffBundle.hashes.sql,
            payloadRef: 'projections/schema-ddl.sql'
          },
          {
            name: 'openapi-spec.json',
            artifactType: 'openapi-spec',
            content: r.handoffBundle.contents?.openApi,
            contentHash: r.handoffBundle.hashes.openApi,
            payloadRef: 'projections/openapi-spec.json'
          },
          {
            name: 'story-order-create.md',
            artifactType: 'story-projection',
            content: r.handoffBundle.contents?.story1,
            contentHash: r.handoffBundle.hashes.story1,
            payloadRef: 'stories/story-order-create.md'
          },
          {
            name: 'story-order-cancel.md',
            artifactType: 'story-projection',
            content: r.handoffBundle.contents?.story2,
            contentHash: r.handoffBundle.hashes.story2,
            payloadRef: 'stories/story-order-cancel.md'
          }
        ],
        proposedDisposition: allSuccess ? 'GO' : 'DESIGN_CHANGE',
        summary: {
          success: allSuccess,
          runsCount: summaries.length,
          totalDurationMs
        }
      });

      const promotionStatus = await statusUseCase.execute({ candidateSha: effectiveSha });
      governanceContext = {
        candidateSha: effectiveSha,
        runRecord,
        promotionStatus
      };
    } else {
      allSuccess = false;
      governanceContext = {
        candidateSha: effectiveSha,
        error: 'No successful validation run completed'
      };
    }
  } catch (err) {
    allSuccess = false;
    const msg = (err as Error).message;
    governanceContext = {
      candidateSha: args.candidateSha ?? gitHeadSha,
      error: msg
    };
    if (!args.silent) {
      console.error('Governance run recording failed:', msg);
    }
  }

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
          runs: summaries,
          governance: governanceContext
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
    const md = generateMarkdownReport(args, summaries, totalDurationMs, governanceContext);
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
