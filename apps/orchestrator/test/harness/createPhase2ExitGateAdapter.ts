import { FakeGenerationGateway } from '../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../fakes/FakeMermaidLinterGateway.js';
import { BabelTsxValidatorAdapter } from '../../src/infrastructure/validation/BabelTsxValidatorAdapter.js';
import type { Phase2ExitGateAdapter } from '../../src/application/harness/runPhase2ExitGate.js';

export function createPhase2TestAdapter(): Phase2ExitGateAdapter {
  return {
    createGenerationGateway: () => new FakeGenerationGateway(),
    createMermaidLinterGateway: () => new FakeMermaidLinterGateway(),
    createPrototypeValidatorGateway: () => new BabelTsxValidatorAdapter()
  };
}
