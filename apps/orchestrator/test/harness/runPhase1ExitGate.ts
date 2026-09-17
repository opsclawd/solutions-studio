import {
  runPhase1ExitGate as runPhase1ExitGateCore,
  type Phase1ExitGateOptions as CoreOptions,
  type Phase1ExitGateResult
} from '../../src/application/harness/runPhase1ExitGate.js';
import { createPhase1TestAdapter } from './createPhase1ExitGateAdapter.js';

export * from '../../src/application/harness/runPhase1ExitGate.js';

export async function runPhase1ExitGate(options: CoreOptions = {}): Promise<Phase1ExitGateResult> {
  return runPhase1ExitGateCore({
    ...options,
    adapter: options.adapter ?? createPhase1TestAdapter()
  });
}
