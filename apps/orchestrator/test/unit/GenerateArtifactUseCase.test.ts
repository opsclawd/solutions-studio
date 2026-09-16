import { describe, it, expect, beforeEach } from 'vitest';
import { GenerateArtifactUseCase } from '../../src/application/use-cases/GenerateArtifactUseCase.js';
import { FakeGenerationGateway } from '../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../fakes/FakeMermaidLinterGateway.js';
import { RepairRetryExhaustionError } from '../../src/application/use-cases/RepairErrors.js';
import {
  CliExecutionTimeoutError,
  NonZeroExitError
} from '../../src/application/ports/generation/GenerationErrors.js';

describe('GenerateArtifactUseCase', () => {
  let fakeGateway: FakeGenerationGateway;
  let fakeLinter: FakeMermaidLinterGateway;
  let useCase: GenerateArtifactUseCase;

  const validMermaid = 'graph TD\n  A[Start] --> B[End]';
  const invalidMermaid = 'graph TD\n  A[Start] -->';
  const repairedMermaid = 'graph TD\n  A[Start] --> B[Resolved]';

  beforeEach(() => {
    fakeGateway = new FakeGenerationGateway();
    fakeLinter = new FakeMermaidLinterGateway();
    useCase = new GenerateArtifactUseCase(fakeGateway, fakeLinter);
  });

  describe('validateAndRepair flow', () => {
    it('passes immediately without repair when initial candidate is valid', async () => {
      const result = await useCase.validateAndRepair(validMermaid);

      expect(result.content).toBe(validMermaid);
      expect(result.repairsNeeded).toBe(0);
      expect(result.repairHistory).toHaveLength(0);
      expect(fakeGateway.recordedRequests).toHaveLength(0);
      expect(fakeLinter.validationCalls).toHaveLength(1);
    });

    it('succeeds on first repair attempt when initial candidate is invalid', async () => {
      fakeGateway.queueResponse(repairedMermaid);

      const result = await useCase.validateAndRepair(invalidMermaid);

      expect(result.content).toBe(repairedMermaid);
      expect(result.repairsNeeded).toBe(1);
      expect(result.repairHistory).toHaveLength(1);
      expect(result.repairHistory[0].attempt).toBe(0);
      expect(fakeGateway.recordedRequests).toHaveLength(1);
      expect(fakeGateway.recordedRequests[0].prompt).toContain(
        'The following Mermaid syntax produced an error:'
      );
      expect(fakeGateway.recordedRequests[0].prompt).toContain(invalidMermaid);
    });

    it('succeeds on second repair attempt when first repair fails', async () => {
      const stillInvalid = 'graph TD\n  A -->';
      const finallyValid = 'graph TD\n  A --> B';

      fakeGateway.queueResponse(stillInvalid);
      fakeGateway.queueResponse(finallyValid);

      const result = await useCase.validateAndRepair(invalidMermaid);

      expect(result.content).toBe(finallyValid);
      expect(result.repairsNeeded).toBe(2);
      expect(result.repairHistory).toHaveLength(2);
      expect(fakeGateway.recordedRequests).toHaveLength(2);
    });

    it('stops after at most 2 failed attempts and throws RepairRetryExhaustionError', async () => {
      fakeGateway.setDefaultResponse(invalidMermaid);

      await expect(useCase.validateAndRepair(invalidMermaid)).rejects.toThrow(
        RepairRetryExhaustionError
      );

      // Attempt 1 repair, attempt 2 repair, then stop
      expect(fakeGateway.recordedRequests).toHaveLength(2);
    });

    it('strips markdown code blocks from repair candidates', async () => {
      fakeGateway.queueResponse('```mermaid\ngraph TD\n  A[Start] --> B[Resolved]\n```');

      const result = await useCase.validateAndRepair(invalidMermaid);

      expect(result.content).toBe(repairedMermaid);
      expect(result.repairsNeeded).toBe(1);
    });
  });

  describe('generateFromPrompt flow', () => {
    it('generates from prompt and repairs if initial output is invalid', async () => {
      fakeGateway.queueResponse(invalidMermaid);
      fakeGateway.queueResponse(repairedMermaid);

      const result = await useCase.generateFromPrompt('Generate a payment flowchart');

      expect(result.content).toBe(repairedMermaid);
      expect(result.repairsNeeded).toBe(1);
      expect(fakeGateway.recordedRequests).toHaveLength(2);
      expect(fakeGateway.recordedRequests[0].prompt).toBe('Generate a payment flowchart');
    });

    it('propagates gateway errors during generation', async () => {
      fakeGateway.queueError(new CliExecutionTimeoutError(10000));

      await expect(useCase.generateFromPrompt('Generate diagram')).rejects.toThrow(
        CliExecutionTimeoutError
      );
    });

    it('propagates gateway errors during repair', async () => {
      fakeGateway.queueResponse(invalidMermaid);
      fakeGateway.queueError(new NonZeroExitError(1, 'Model failed', ''));

      await expect(useCase.validateAndRepair(invalidMermaid)).rejects.toThrow(NonZeroExitError);
    });
  });
});
