import { FakeGenerationGateway } from '../fakes/FakeGenerationGateway.js';
import { FakeBacklogExportGateway } from '../fakes/FakeBacklogExportGateway.js';
import { PGliteSqlValidatorAdapter } from '../../src/infrastructure/validation/PGliteSqlValidatorAdapter.js';
import { OpenApiStructuralValidatorAdapter } from '../../src/infrastructure/validation/OpenApiStructuralValidatorAdapter.js';
import { GherkinValidatorAdapter } from '../../src/infrastructure/validation/GherkinValidatorAdapter.js';
import { TestAuthenticator } from '../../src/infrastructure/identity/TestAuthenticator.js';
import { createPhase1TestAdapter } from './createPhase1ExitGateAdapter.js';
import { createPhase2TestAdapter } from './createPhase2ExitGateAdapter.js';
import { createPhase3TestAdapter } from './createPhase3ExitGateAdapter.js';
import type { Phase4ExitGateAdapter } from '../../src/application/harness/runPhase4ExitGate.js';

export function createPhase4TestAdapter(): Phase4ExitGateAdapter {
  return {
    createAuthenticator: () => new TestAuthenticator({ allowAnonymousFallback: false }),
    createGenerationGateway: () => new FakeGenerationGateway(),
    createSqlValidatorGateway: () => new PGliteSqlValidatorAdapter(),
    createOpenApiValidatorGateway: () => new OpenApiStructuralValidatorAdapter(),
    createGherkinValidatorGateway: () => new GherkinValidatorAdapter(),
    createBacklogGateway: () => new FakeBacklogExportGateway('fake-github'),
    createPhase1Adapter: () => createPhase1TestAdapter(),
    createPhase2Adapter: () => createPhase2TestAdapter(),
    createPhase3Adapter: () => createPhase3TestAdapter()
  };
}
