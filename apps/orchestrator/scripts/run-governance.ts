#!/usr/bin/env tsx
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  createCandidateSha,
  createValidationRunId,
  createGovernanceApprovalId
} from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { TestAuthenticator } from '../src/infrastructure/identity/TestAuthenticator.js';
import { DefaultAuthorizationPolicy } from '../src/infrastructure/identity/DefaultAuthorizationPolicy.js';
import {
  ApproveCandidateUseCase,
  EvaluateCandidatePromotionStatusUseCase,
  RevokeGovernanceApprovalUseCase,
  ExportGovernanceAuditUseCase
} from '../src/application/use-cases/governance/index.js';

export interface GovernanceCliArgs {
  command: 'approve' | 'status' | 'revoke' | 'export' | 'help';
  candidateSha?: string;
  runId?: string;
  evidenceDigest?: string;
  decision?: 'GO' | 'DESIGN_CHANGE';
  rationale?: string;
  approvalId?: string;
  supersedes?: string;
  token?: string;
  storeDir?: string;
  url?: string;
  failClosed?: boolean;
  allowTestAuthenticator?: boolean;
  outFile?: string;
  outDir?: string;
  json?: boolean;
}

export function parseGovernanceArgs(args: string[]): GovernanceCliArgs {
  if (args.length === 0 || args.includes('--help') || args.includes('-h') || args[0] === 'help') {
    return { command: 'help' };
  }

  const first = args[0].toLowerCase();
  let command: GovernanceCliArgs['command'] = 'help';
  let startIndex = 0;

  if (['approve', 'status', 'revoke', 'export', 'help'].includes(first)) {
    command = first as GovernanceCliArgs['command'];
    startIndex = 1;
  }

  let candidateSha: string | undefined = process.env.CANDIDATE_SHA;
  let runId: string | undefined = process.env.VALIDATION_RUN_ID;
  let evidenceDigest: string | undefined = process.env.EVIDENCE_DIGEST;
  let decision: 'GO' | 'DESIGN_CHANGE' = 'GO';
  let rationale: string | undefined;
  let approvalId: string | undefined;
  let supersedes: string | undefined;
  let token: string | undefined = process.env.AUTH_TOKEN ?? process.env.GOVERNANCE_TOKEN;
  let storeDir: string | undefined = process.env.STORE_DIR;
  let url: string | undefined = process.env.API_URL;
  let failClosed = false;
  let allowTestAuthenticator = false;
  let outFile: string | undefined;
  let outDir: string | undefined;
  let json = false;

  for (let i = startIndex; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--sha' && i + 1 < args.length) {
      candidateSha = args[++i];
    } else if (arg === '--run-id' && i + 1 < args.length) {
      runId = args[++i];
    } else if (arg === '--digest' && i + 1 < args.length) {
      evidenceDigest = args[++i];
    } else if (arg === '--decision' && i + 1 < args.length) {
      const d = args[++i].toUpperCase();
      if (d !== 'GO' && d !== 'DESIGN_CHANGE') {
        throw new Error(`Invalid --decision: '${d}'. Must be GO or DESIGN_CHANGE.`);
      }
      decision = d;
    } else if (arg === '--rationale' && i + 1 < args.length) {
      rationale = args[++i];
    } else if (arg === '--approval-id' && i + 1 < args.length) {
      approvalId = args[++i];
    } else if (arg === '--supersedes' && i + 1 < args.length) {
      supersedes = args[++i];
    } else if (arg === '--token' && i + 1 < args.length) {
      token = args[++i];
    } else if (arg === '--store' && i + 1 < args.length) {
      storeDir = path.resolve(process.cwd(), args[++i]);
    } else if (arg === '--url' && i + 1 < args.length) {
      url = args[++i];
    } else if (arg === '--fail-closed') {
      failClosed = true;
    } else if (arg === '--allow-test-authenticator') {
      allowTestAuthenticator = true;
    } else if (arg === '--out-file' && i + 1 < args.length) {
      outFile = path.resolve(process.cwd(), args[++i]);
    } else if (arg === '--out-dir' && i + 1 < args.length) {
      outDir = path.resolve(process.cwd(), args[++i]);
    } else if (arg === '--json') {
      json = true;
    }
  }

  return {
    command,
    candidateSha,
    runId,
    evidenceDigest,
    decision,
    rationale,
    approvalId,
    supersedes,
    token,
    storeDir,
    url,
    failClosed,
    allowTestAuthenticator,
    outFile,
    outDir,
    json
  };
}

export function printHelp(): void {
  console.log(`
Usage: tsx scripts/run-governance.ts <command> [options]

Commands:
  approve     Record human promotion approval for a candidate SHA
  status      Evaluate candidate promotion readiness status
  revoke      Revoke an active promotion approval
  export      Export complete governance audit package for a candidate SHA
  help        Display this help message

Options:
  --sha <commitSha>          Candidate git commit SHA
  --run-id <runId>           Validation run ID to bind approval to
  --digest <sha256>          Evidence digest hash to bind approval to
  --decision <GO|DESIGN_CHANGE> Decision disposition (default: GO)
  --rationale <text>         Human reviewer rationale / audit justification
  --approval-id <id>         Approval ID (for revoke)
  --supersedes <id>          Prior approval ID superseded by this record
  --token <token>            Auth token (Bearer token, required for approve/revoke)
  --allow-test-authenticator Allow TestAuthenticator in direct mode
  --store <dir>              Store directory for filesystem repository
  --url <httpUrl>            Base URL of orchestrator HTTP API (optional)
  --fail-closed              Exit with code 1 if status is not APPROVED
  --out-file <path>          Output file path for export
  --out-dir <path>           Output directory for export
  --json                     Output JSON format
`);
}

async function resolveDirectRepository(storeDir?: string) {
  const effectiveDir = storeDir ?? path.resolve(process.cwd(), '.data/requirements');
  await fs.mkdir(effectiveDir, { recursive: true });
  const repo = new FilesystemRequirementsRepository({ baseDir: effectiveDir });
  const authorizer = new DefaultAuthorizationPolicy();
  const authenticator = new TestAuthenticator({ allowAnonymousFallback: false });

  const statusUseCase = new EvaluateCandidatePromotionStatusUseCase(repo);

  return {
    repo,
    authorizer,
    authenticator,
    approveUseCase: new ApproveCandidateUseCase(repo, authorizer),
    statusUseCase,
    revokeUseCase: new RevokeGovernanceApprovalUseCase(repo, authorizer),
    exportUseCase: new ExportGovernanceAuditUseCase(repo, statusUseCase)
  };
}

async function handleApprove(args: GovernanceCliArgs) {
  if (!args.candidateSha) {
    throw new Error('Missing required argument: --sha <candidateSha>');
  }
  if (!args.runId) {
    throw new Error('Missing required argument: --run-id <runId>');
  }
  if (!args.evidenceDigest) {
    throw new Error('Missing required argument: --digest <evidenceDigest>');
  }
  if (!args.rationale || args.rationale.trim().length === 0) {
    throw new Error('Missing required argument: --rationale "<audit rationale>"');
  }

  if (!args.token || args.token.trim().length === 0) {
    throw new Error('Missing required argument: --token <bearerToken>');
  }

  const token = args.token.trim();

  if (args.url) {
    const res = await fetch(`${args.url.replace(/\/$/, '')}/api/governance/approvals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        candidateSha: args.candidateSha,
        validationRunId: args.runId,
        evidenceDigest: args.evidenceDigest,
        decision: args.decision ?? 'GO',
        rationale: args.rationale,
        supersedes: args.supersedes
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HTTP ${res.status}: ${err}`);
    }

    const approval = await res.json();
    if (args.json) {
      console.log(JSON.stringify(approval, null, 2));
    } else {
      console.log(`✅ Candidate approval recorded successfully.`);
      console.log(`  Approval ID:     ${approval.id}`);
      console.log(`  Candidate SHA:   ${approval.candidateSha}`);
      console.log(`  Decision:        ${approval.decision}`);
      console.log(`  Status:          ${approval.status}`);
      console.log(`  Reviewer:        ${approval.actor.name} (${approval.actor.id})`);
      console.log(`  Evidence Digest: ${approval.evidenceDigest}`);
    }
    return approval;
  }

  if (process.env.NODE_ENV !== 'test' && !args.allowTestAuthenticator) {
    throw new Error(
      'Direct mode execution with TestAuthenticator requires --allow-test-authenticator or NODE_ENV=test. In production, use --url to target the authenticated HTTP server.'
    );
  }

  const direct = await resolveDirectRepository(args.storeDir);
  const actor = await direct.authenticator.authenticate(token);
  const approval = await direct.approveUseCase.execute({
    candidateSha: createCandidateSha(args.candidateSha),
    validationRunId: createValidationRunId(args.runId),
    evidenceDigest: args.evidenceDigest,
    decision: args.decision ?? 'GO',
    rationale: args.rationale,
    supersedes: args.supersedes ? createGovernanceApprovalId(args.supersedes) : undefined,
    actor
  });

  if (args.json) {
    console.log(JSON.stringify(approval, null, 2));
  } else {
    console.log(`✅ Candidate approval recorded successfully.`);
    console.log(`  Approval ID:     ${approval.id}`);
    console.log(`  Candidate SHA:   ${approval.candidateSha}`);
    console.log(`  Decision:        ${approval.decision}`);
    console.log(`  Status:          ${approval.status}`);
    console.log(`  Reviewer:        ${approval.actor.name} (${approval.actor.id})`);
    console.log(`  Evidence Digest: ${approval.evidenceDigest}`);
  }
  return approval;
}

interface CliStatusView {
  candidateSha: string;
  disposition: string;
  isApproved: boolean;
  diagnosticCode: string;
  message: string;
  activeApproval?: {
    id: string;
    decision: string;
    decidedAt?: string;
    actor: {
      id: string;
      name: string;
    };
  };
}

async function handleStatus(args: GovernanceCliArgs) {
  if (!args.candidateSha) {
    throw new Error('Missing required argument: --sha <candidateSha>');
  }

  let status: CliStatusView;
  if (args.url) {
    const res = await fetch(
      `${args.url.replace(/\/$/, '')}/api/governance/candidates/${args.candidateSha}/status`
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HTTP ${res.status}: ${err}`);
    }
    status = (await res.json()) as CliStatusView;
  } else {
    const direct = await resolveDirectRepository(args.storeDir);
    status = (await direct.statusUseCase.execute({
      candidateSha: args.candidateSha
    })) as unknown as CliStatusView;
  }

  if (args.json) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    console.log(`\n--- Candidate Promotion Status ---`);
    console.log(`  Candidate SHA:    ${status.candidateSha}`);
    console.log(`  Disposition:      ${status.disposition}`);
    console.log(`  Promotion Ready:  ${status.isApproved ? 'YES (APPROVED)' : 'NO (UNAPPROVED)'}`);
    console.log(`  Diagnostic Code:  ${status.diagnosticCode}`);
    console.log(`  Message:          ${status.message}`);
    if (status.activeApproval) {
      console.log(
        `  Active Reviewer:  ${status.activeApproval.actor.name} (${status.activeApproval.actor.id})`
      );
      console.log(`  Approval ID:      ${status.activeApproval.id}`);
      console.log(`  Decision:         ${status.activeApproval.decision}`);
      console.log(`  Signed At:        ${status.activeApproval.decidedAt}`);
    }
  }

  if (args.failClosed && !status.isApproved) {
    console.error(
      `\n❌ FAIL CLOSED: Candidate SHA '${args.candidateSha}' is NOT approved for promotion (status: ${status.disposition}, code: ${status.diagnosticCode}).`
    );
    process.exit(1);
  }

  return status;
}

async function handleRevoke(args: GovernanceCliArgs) {
  if (!args.approvalId) {
    throw new Error('Missing required argument: --approval-id <approvalId>');
  }
  if (!args.rationale || args.rationale.trim().length === 0) {
    throw new Error('Missing required argument: --rationale "<revocation rationale>"');
  }

  if (!args.token || args.token.trim().length === 0) {
    throw new Error('Missing required argument: --token <bearerToken>');
  }

  const token = args.token.trim();

  if (args.url) {
    const res = await fetch(
      `${args.url.replace(/\/$/, '')}/api/governance/approvals/${args.approvalId}/revoke`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          rationale: args.rationale
        })
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HTTP ${res.status}: ${err}`);
    }

    const revoked = await res.json();
    if (args.json) {
      console.log(JSON.stringify(revoked, null, 2));
    } else {
      console.log(`⚠️ Candidate approval revoked successfully.`);
      console.log(`  Approval ID: ${revoked.id}`);
      console.log(`  Status:      ${revoked.status}`);
      console.log(`  Revoked By:  ${revoked.revocation?.revokedBy.name}`);
      console.log(`  Rationale:   ${revoked.revocation?.rationale}`);
    }
    return revoked;
  }

  if (process.env.NODE_ENV !== 'test' && !args.allowTestAuthenticator) {
    throw new Error(
      'Direct mode execution with TestAuthenticator requires --allow-test-authenticator or NODE_ENV=test. In production, use --url to target the authenticated HTTP server.'
    );
  }

  const direct = await resolveDirectRepository(args.storeDir);
  const actor = await direct.authenticator.authenticate(token);
  const revoked = await direct.revokeUseCase.execute({
    approvalId: createGovernanceApprovalId(args.approvalId),
    rationale: args.rationale,
    actor
  });

  if (args.json) {
    console.log(JSON.stringify(revoked, null, 2));
  } else {
    console.log(`⚠️ Candidate approval revoked successfully.`);
    console.log(`  Approval ID: ${revoked.id}`);
    console.log(`  Status:      ${revoked.status}`);
    console.log(`  Revoked By:  ${revoked.revocation?.revokedBy.name}`);
    console.log(`  Rationale:   ${revoked.revocation?.rationale}`);
  }
  return revoked;
}

async function handleExport(args: GovernanceCliArgs) {
  if (!args.candidateSha) {
    throw new Error('Missing required argument: --sha <candidateSha>');
  }

  let pkg: unknown;
  if (args.url) {
    const res = await fetch(
      `${args.url.replace(/\/$/, '')}/api/governance/audit/export?candidateSha=${args.candidateSha}`
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HTTP ${res.status}: ${err}`);
    }
    pkg = await res.json();
  } else {
    const direct = await resolveDirectRepository(args.storeDir);
    pkg = await direct.exportUseCase.execute({ candidateSha: args.candidateSha });
  }

  const payloadStr = JSON.stringify(pkg, null, 2);

  if (args.outFile) {
    await fs.mkdir(path.dirname(args.outFile), { recursive: true });
    await fs.writeFile(args.outFile, payloadStr + '\n', 'utf8');
    console.log(`Wrote governance audit package to: ${args.outFile}`);
  } else if (args.outDir) {
    await fs.mkdir(args.outDir, { recursive: true });
    const target = path.join(
      args.outDir,
      `governance-audit-${args.candidateSha.slice(0, 12)}.json`
    );
    await fs.writeFile(target, payloadStr + '\n', 'utf8');
    console.log(`Wrote governance audit package to: ${target}`);
  } else {
    console.log(payloadStr);
  }

  return pkg;
}

export async function runGovernanceCli(argv: string[]): Promise<void> {
  const args = parseGovernanceArgs(argv);

  switch (args.command) {
    case 'approve':
      await handleApprove(args);
      break;
    case 'status':
      await handleStatus(args);
      break;
    case 'revoke':
      await handleRevoke(args);
      break;
    case 'export':
      await handleExport(args);
      break;
    case 'help':
    default:
      printHelp();
      break;
  }
}

const isDirectCli =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('run-governance.ts') || process.argv[1].endsWith('run-governance.js'));

if (isDirectCli) {
  runGovernanceCli(process.argv.slice(2)).catch((err) => {
    console.error(`Governance CLI Error: ${(err as Error).message}`);
    process.exit(1);
  });
}
