import { FakeGenerationGateway } from '../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../fakes/FakeMermaidLinterGateway.js';
import { loadFixture } from '../../src/infrastructure/evaluation/loadFixture.js';
import type { Phase1ExitGateAdapter } from '../../src/application/harness/runPhase1ExitGate.js';

export function createPhase1TestAdapter(): Phase1ExitGateAdapter {
  return {
    createGenerationGateway: () => new FakeGenerationGateway(),
    createMermaidLinterGateway: () => new FakeMermaidLinterGateway(),
    loadFixture
  };
}
