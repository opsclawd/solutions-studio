#!/usr/bin/env tsx
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  GenerateArtifactUseCase,
  RepairRetryExhaustionError
} from '../src/application/use-cases/GenerateArtifactUseCase.js';
import { GatewayFactory } from '../src/infrastructure/generation/GatewayFactory.js';
import type { ProviderType } from '../src/infrastructure/generation/GatewayFactory.js';
import { MermaidCliLinterAdapter } from '../src/infrastructure/validation/MermaidCliLinterAdapter.js';
import { FakeGenerationGateway } from '../test/fakes/FakeGenerationGateway.js';

async function main() {
  const args = process.argv.slice(2);
  let providerArg: ProviderType = 'fake';
  let fixturePath = path.resolve(process.cwd(), 'test/fixtures/mermaid/invalid-syntax.mmd');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider' && args[i + 1]) {
      providerArg = args[i + 1] as ProviderType;
      i++;
    } else if (args[i] === '--fixture' && args[i + 1]) {
      fixturePath = path.resolve(process.cwd(), args[i + 1]);
      i++;
    }
  }

  console.log('====================================================');
  console.log('Solutions Studio: Phase 0 Spike A Tracer');
  console.log(`Provider: ${providerArg}`);
  console.log(`Fixture:  ${fixturePath}`);
  console.log('====================================================\n');

  const fixtureContent = await fs.readFile(fixturePath, 'utf-8');
  console.log('--- Input Fixture ---');
  console.log(fixtureContent);
  console.log('---------------------\n');

  let fakeFallback: FakeGenerationGateway | undefined;
  if (providerArg === 'fake') {
    const repairedFixturePath = path.resolve(
      process.cwd(),
      'test/fixtures/mermaid/repaired-flowchart.mmd'
    );
    const repairedContent = await fs.readFile(repairedFixturePath, 'utf-8');
    fakeFallback = new FakeGenerationGateway([repairedContent]);
  }

  const gateway = GatewayFactory.createGateway({ provider: providerArg }, fakeFallback);
  const linter = new MermaidCliLinterAdapter();
  const useCase = new GenerateArtifactUseCase(gateway, linter);

  console.log('Starting closed-loop validation and repair...');
  const startTime = Date.now();

  try {
    const result = await useCase.validateAndRepair(fixtureContent, {
      maxRepairAttempts: 2
    });
    const duration = Date.now() - startTime;

    console.log('\n================ Tracer Succeeded ================');
    console.log(`Duration:       ${duration}ms`);
    console.log(`Repairs Needed: ${result.repairsNeeded}`);
    console.log(`History:        ${result.repairHistory.length} recorded failure(s)`);
    result.repairHistory.forEach((h) => {
      console.log(`  [Attempt ${h.attempt}] Error: ${h.errorMessage.split('\n')[0]}`);
    });
    console.log('\n--- Final Validated Mermaid Output ---');
    console.log(result.content);
    console.log('====================================================\n');
  } catch (error) {
    console.error('\n================ Tracer Failed ====================');
    console.error((error as Error).message);
    if (error instanceof RepairRetryExhaustionError) {
      console.error('History of errors:', error.errors);
    }
    console.error('====================================================\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error running tracer:', err);
  process.exit(1);
});
