import {
  runPhase3ExitGate as runPhase3ExitGateCore,
  type Phase3ExitGateOptions as CoreOptions,
  type Phase3ExitGateResult
} from '../../src/application/harness/runPhase3ExitGate.js';
import { createPhase3TestAdapter } from './createPhase3ExitGateAdapter.js';

export * from '../../src/application/harness/runPhase3ExitGate.js';

export async function runPhase3ExitGate(options: CoreOptions = {}): Promise<Phase3ExitGateResult> {
  const isReal = options.provider && options.provider !== 'fake';
  return runPhase3ExitGateCore({
    ...options,
    adapter: options.adapter ?? (isReal ? undefined : createPhase3TestAdapter())
  });
}
