import type { IGenerationGateway } from '../ports/generation/IGenerationGateway.js';
import type { IMermaidLinterGateway } from '../ports/validation/IMermaidLinterGateway.js';
import {
  type ITelemetryRegistry,
  type IOperationalLogger,
  TelemetryProvider,
  OperationalLogger
} from '../ports/observability/index.js';
import { RepairRetryExhaustionError } from './RepairErrors.js';

export { RepairRetryExhaustionError } from './RepairErrors.js';

export interface GenerateArtifactOptions {
  maxRepairAttempts?: number;
  artifactType?: string;
}

export interface RepairAttemptRecord {
  attempt: number;
  candidate: string;
  errorMessage: string;
}

export interface ArtifactGenerationResult {
  content: string;
  repairsNeeded: number;
  repairHistory: RepairAttemptRecord[];
}

export class GenerateArtifactUseCase {
  private readonly defaultMaxRepairAttempts = 2;

  constructor(
    private readonly generationGateway: IGenerationGateway,
    private readonly linterGateway: IMermaidLinterGateway,
    private readonly telemetryRegistry?: ITelemetryRegistry,
    private readonly operationalLogger?: IOperationalLogger
  ) {}

  /**
   * Generates a Mermaid artifact from a prompt and repairs it if invalid.
   */
  async generateFromPrompt(
    prompt: string,
    options?: GenerateArtifactOptions
  ): Promise<ArtifactGenerationResult> {
    const start = Date.now();
    const artifactType = options?.artifactType ?? 'mermaid';
    const reg = this.telemetryRegistry ?? TelemetryProvider.default;

    try {
      const initialGeneration = await this.generationGateway.generate({ prompt });
      const cleanedCandidate = this.extractMermaidContent(initialGeneration.text);
      const result = await this.validateAndRepair(cleanedCandidate, options);
      const durationMs = Date.now() - start;
      const provider = initialGeneration.metadata?.provider ?? 'default';
      const model = initialGeneration.metadata?.model ?? 'default';

      (this.operationalLogger ?? OperationalLogger).log('generation.call.completed', {
        provider,
        model,
        artifactType,
        promptLengthBytes: Buffer.byteLength(prompt, 'utf8'),
        repairsNeeded: result.repairsNeeded,
        attemptCount: 1 + result.repairsNeeded,
        durationMs,
        status: 'success'
      });

      reg.incrementCounter('solutions_studio_generation_calls_total', {
        provider,
        artifact_type: artifactType,
        status: 'success'
      });
      reg.observeHistogram('solutions_studio_generation_duration_ms', durationMs, {
        provider,
        artifact_type: artifactType
      });
      if (result.repairsNeeded > 0) {
        reg.incrementCounter(
          'solutions_studio_generation_repairs_total',
          {
            provider,
            artifact_type: artifactType
          },
          result.repairsNeeded
        );
      }

      return result;
    } catch (err) {
      const durationMs = Date.now() - start;
      (this.operationalLogger ?? OperationalLogger).log(
        'generation.call.completed',
        {
          provider: 'default',
          artifactType,
          promptLengthBytes: Buffer.byteLength(prompt, 'utf8'),
          durationMs,
          status: 'failed'
        },
        { level: 'error' }
      );

      reg.incrementCounter('solutions_studio_generation_calls_total', {
        provider: 'default',
        artifact_type: artifactType,
        status: 'failed'
      });
      throw err;
    }
  }

  /**
   * Validates an initial candidate and executes the closed-loop repair flow if invalid.
   * Tracer flow:
   *   Candidate -> Validator -> If Valid: Done
   *   If Invalid -> Build repair prompt -> Gateway.generate -> Validator -> ...
   * Stops after at most maxRepairAttempts (default 2) and throws RepairRetryExhaustionError.
   */
  async validateAndRepair(
    initialCandidate: string,
    options?: GenerateArtifactOptions
  ): Promise<ArtifactGenerationResult> {
    const maxAttempts = options?.maxRepairAttempts ?? this.defaultMaxRepairAttempts;
    let currentCandidate = this.extractMermaidContent(initialCandidate);
    const repairHistory: RepairAttemptRecord[] = [];
    const reg = this.telemetryRegistry ?? TelemetryProvider.default;

    // Step 1: Initial validation
    const valStart1 = Date.now();
    const initialValidation = await this.linterGateway.validate(currentCandidate);
    const valDuration1 = Date.now() - valStart1;

    (this.operationalLogger ?? OperationalLogger).log('validation.executed', {
      validatorType: 'mermaid',
      isValid: initialValidation.isValid,
      errorCount: initialValidation.isValid ? 0 : 1,
      durationMs: valDuration1
    });

    if (!initialValidation.isValid) {
      reg.incrementCounter('solutions_studio_validation_failures_total', {
        validator_type: 'mermaid',
        error_category: 'syntax'
      });
    }

    if (initialValidation.isValid) {
      return {
        content: currentCandidate,
        repairsNeeded: 0,
        repairHistory: []
      };
    }

    // Candidate is invalid, record failure and enter repair loop
    repairHistory.push({
      attempt: 0,
      candidate: currentCandidate,
      errorMessage: initialValidation.errorMessage ?? 'Unknown validation error'
    });

    let repairAttempts = 0;
    while (repairAttempts < maxAttempts) {
      repairAttempts++;
      const lastError = repairHistory[repairHistory.length - 1].errorMessage;
      const repairPrompt = this.buildRepairPrompt(currentCandidate, lastError);

      const repairResult = await this.generationGateway.generate({
        prompt: repairPrompt
      });

      currentCandidate = this.extractMermaidContent(repairResult.text);
      const valStart2 = Date.now();
      const validation = await this.linterGateway.validate(currentCandidate);
      const valDuration2 = Date.now() - valStart2;

      (this.operationalLogger ?? OperationalLogger).log('validation.executed', {
        validatorType: 'mermaid',
        isValid: validation.isValid,
        errorCount: validation.isValid ? 0 : 1,
        durationMs: valDuration2
      });

      if (!validation.isValid) {
        reg.incrementCounter('solutions_studio_validation_failures_total', {
          validator_type: 'mermaid',
          error_category: 'syntax'
        });
      }

      if (validation.isValid) {
        return {
          content: currentCandidate,
          repairsNeeded: repairAttempts,
          repairHistory
        };
      }

      repairHistory.push({
        attempt: repairAttempts,
        candidate: currentCandidate,
        errorMessage: validation.errorMessage ?? 'Unknown validation error'
      });
    }

    // If still invalid after max attempts, throw typed exhaustion failure
    const errorMessages = repairHistory.map((h) => `Attempt ${h.attempt}: ${h.errorMessage}`);
    throw new RepairRetryExhaustionError(
      `Repair failed after ${maxAttempts} attempt(s). Diagram remains invalid.`,
      repairAttempts,
      currentCandidate,
      errorMessages
    );
  }

  private buildRepairPrompt(invalidCode: string, errorMessage: string): string {
    return (
      `The following Mermaid syntax produced an error: ${errorMessage}\n\n` +
      `Correct the syntax and return ONLY the valid Mermaid diagram code without commentary:\n\n${invalidCode}`
    );
  }

  /**
   * Normalizes output by extracting mermaid code from markdown fences if present.
   */
  private extractMermaidContent(text: string): string {
    const trimmed = text.trim();
    const fenceMatch = trimmed.match(/```(?:mermaid)?\r?\n([\s\S]*?)\r?\n```/i);
    if (fenceMatch) {
      return fenceMatch[1].trim();
    }
    return trimmed;
  }
}
