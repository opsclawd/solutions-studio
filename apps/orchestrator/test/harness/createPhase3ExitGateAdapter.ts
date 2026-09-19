import { FakeGenerationGateway } from '../fakes/FakeGenerationGateway.js';
import { PGliteSqlValidatorAdapter } from '../../src/infrastructure/validation/PGliteSqlValidatorAdapter.js';
import { OpenApiStructuralValidatorAdapter } from '../../src/infrastructure/validation/OpenApiStructuralValidatorAdapter.js';
import { GherkinValidatorAdapter } from '../../src/infrastructure/validation/GherkinValidatorAdapter.js';
import type { Phase3ExitGateAdapter } from '../../src/application/harness/runPhase3ExitGate.js';

export function createPhase3TestAdapter(): Phase3ExitGateAdapter {
  return {
    createGenerationGateway: () => new FakeGenerationGateway(),
    createSqlValidatorGateway: () => new PGliteSqlValidatorAdapter(),
    createOpenApiValidatorGateway: () => new OpenApiStructuralValidatorAdapter(),
    createGherkinValidatorGateway: () => new GherkinValidatorAdapter()
  };
}
