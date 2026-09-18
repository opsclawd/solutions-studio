#!/usr/bin/env tsx
import path from 'node:path';
import { composeOrchestratorHttpServer } from '../src/http/composition.js';

export interface HttpServerArgs {
  readonly port: number;
  readonly host: string;
  readonly storeDir?: string;
}

export function parseArgs(args: string[]): HttpServerArgs {
  let port = Number(process.env.PORT) || 3000;
  let host = process.env.HOST || '0.0.0.0';
  let storeDir: string | undefined = undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: tsx scripts/run-http-server.ts [--port <number>] [--host <string>] [--store <path>]\n' +
          'Note: Recommended port is 4000 when running alongside Next.js web app (PORT=4000 or --port 4000).'
      );
      process.exit(0);
    } else if (arg === '--port') {
      const val = args[++i];
      const parsed = Number(val);
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        throw new Error(`Invalid port: '${val}'`);
      }
      port = parsed;
    } else if (arg === '--host') {
      host = args[++i];
    } else if (arg === '--store') {
      storeDir = path.resolve(process.cwd(), args[++i]);
    } else {
      throw new Error(`Unknown option: '${arg}'`);
    }
  }

  return { port, host, storeDir };
}

export async function main() {
  const cliArgs = parseArgs(process.argv.slice(2));
  const server = composeOrchestratorHttpServer({
    storeDir: cliArgs.storeDir,
    fastifyOptions: {
      logger: true
    }
  });

  const address = await server.app.listen({
    port: cliArgs.port,
    host: cliArgs.host
  });

  console.log(`Orchestrator HTTP server listening on ${address}`);
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  (import.meta.url === `file://${path.resolve(process.argv[1])}` ||
    process.argv[1].endsWith('run-http-server.ts') ||
    process.argv[1].endsWith('run-http-server.js'));

if (isDirectRun) {
  main().catch((err) => {
    console.error('\nFatal error running orchestrator HTTP server:', err);
    process.exit(1);
  });
}
