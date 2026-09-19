import {
  runPhase2ExitGate as runPhase2ExitGateCore,
  type Phase2ExitGateOptions as CoreOptions,
  type Phase2ExitGateResult
} from '../../src/application/harness/runPhase2ExitGate.js';
import { createPhase2TestAdapter } from './createPhase2ExitGateAdapter.js';

export * from '../../src/application/harness/runPhase2ExitGate.js';

export async function runPhase2ExitGate(options: CoreOptions = {}): Promise<Phase2ExitGateResult> {
  return runPhase2ExitGateCore({
    ...options,
    adapter: options.adapter ?? createPhase2TestAdapter()
  });
}
