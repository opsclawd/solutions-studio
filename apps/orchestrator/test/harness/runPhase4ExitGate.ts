import {
  runPhase4ExitGate as runPhase4ExitGateCore,
  type Phase4ExitGateOptions as CoreOptions,
  type Phase4ExitGateResult
} from '../../src/application/harness/runPhase4ExitGate.js';
import { createPhase4TestAdapter } from './createPhase4ExitGateAdapter.js';

export * from '../../src/application/harness/runPhase4ExitGate.js';

export async function runPhase4ExitGate(options: CoreOptions = {}): Promise<Phase4ExitGateResult> {
  const isReal = options.provider && options.provider !== 'fake';
  return runPhase4ExitGateCore({
    ...options,
    adapter: options.adapter ?? (isReal ? undefined : createPhase4TestAdapter())
  });
}
