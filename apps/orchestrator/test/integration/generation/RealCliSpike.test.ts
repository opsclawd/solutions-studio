import { describe, it, expect } from 'vitest';
import { GenerateArtifactUseCase } from '../../../src/application/use-cases/GenerateArtifactUseCase.js';
import { AntigravityCliAdapter } from '../../../src/infrastructure/generation/AntigravityCliAdapter.js';
import { OpenCodeCliAdapter } from '../../../src/infrastructure/generation/OpenCodeCliAdapter.js';
import { MermaidCliLinterAdapter } from '../../../src/infrastructure/validation/MermaidCliLinterAdapter.js';
import { GatewayFactory } from '../../../src/infrastructure/generation/GatewayFactory.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

describe('Real CLI Integration Spike (Synthetic Fixtures Only)', () => {
  const linter = new MermaidCliLinterAdapter();

  describe('AntigravityCliAdapter (agy)', () => {
    it('participates in closed-loop Mermaid repair without orchestration changes', async () => {
      const gateway = new AntigravityCliAdapter();
      const useCase = new GenerateArtifactUseCase(gateway, linter);

      const invalidFixturePath = path.resolve(
        process.cwd(),
        'test/fixtures/mermaid/invalid-syntax.mmd'
      );
      const invalidCode = await fs.readFile(invalidFixturePath, 'utf-8');

      const result = await useCase.validateAndRepair(invalidCode, {
        maxRepairAttempts: 2,
      });

      expect(result.content).toBeDefined();
      expect(result.repairsNeeded).toBeGreaterThanOrEqual(1);

      // Verify the final diagram is validated successfully by Mermaid linter
      const validation = await linter.validate(result.content);
      expect(validation.isValid).toBe(true);
    }, 90_000);
  });

  describe('OpenCodeCliAdapter (opencode)', () => {
    it('participates in closed-loop Mermaid repair without orchestration changes', async () => {
      const gateway = new OpenCodeCliAdapter();
      const useCase = new GenerateArtifactUseCase(gateway, linter);

      const invalidFixturePath = path.resolve(
        process.cwd(),
        'test/fixtures/mermaid/invalid-syntax.mmd'
      );
      const invalidCode = await fs.readFile(invalidFixturePath, 'utf-8');

      const result = await useCase.validateAndRepair(invalidCode, {
        maxRepairAttempts: 2,
      });

      expect(result.content).toBeDefined();
      expect(result.repairsNeeded).toBeGreaterThanOrEqual(1);

      // Verify the final diagram is validated successfully by Mermaid linter
      const validation = await linter.validate(result.content);
      expect(validation.isValid).toBe(true);
    }, 90_000);
  });

  describe('Configuration-driven GatewayFactory', () => {
    it('instantiates the configured provider seamlessly', () => {
      const agyGateway = GatewayFactory.createGateway({ provider: 'agy' });
      expect(agyGateway).toBeInstanceOf(AntigravityCliAdapter);

      const opencodeGateway = GatewayFactory.createGateway({
        provider: 'opencode',
      });
      expect(opencodeGateway).toBeInstanceOf(OpenCodeCliAdapter);
    });
  });
});
