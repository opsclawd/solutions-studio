#!/usr/bin/env tsx
import path from 'node:path';
import { runPhase1ExitGate } from '../test/harness/runPhase1ExitGate.js';

function parseArgs(args: string[]): { storeDir?: string; cleanup?: boolean } {
  let storeDir: string | undefined;
  let cleanup = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--store' && i + 1 < args.length) {
      storeDir = path.resolve(process.cwd(), args[++i]);
      cleanup = false;
    } else if (arg === '--keep-store') {
      cleanup = false;
    }
  }

  return { storeDir, cleanup };
}

async function main() {
  const { storeDir, cleanup } = parseArgs(process.argv.slice(2));

  try {
    const result = await runPhase1ExitGate({
      storeDir,
      cleanup,
      silent: false
    });

    if (!result.success) {
      process.exit(1);
    }
  } catch (err) {
    console.error('\nFatal error running Phase 1 exit gate:', err);
    process.exit(1);
  }
}

main();
