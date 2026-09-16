import { IGenerationGateway } from '../ports/generation/IGenerationGateway.js';
import { IMermaidLinterGateway } from '../ports/validation/IMermaidLinterGateway.js';
import { RepairRetryExhaustionError } from './RepairErrors.js';

export { RepairRetryExhaustionError } from './RepairErrors.js';

export interface GenerateArtifactOptions {
  maxRepairAttempts?: number;
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
    private readonly linterGateway: IMermaidLinterGateway
  ) {}

  /**
   * Generates a Mermaid artifact from a prompt and repairs it if invalid.
   */
  async generateFromPrompt(
    prompt: string,
    options?: GenerateArtifactOptions
  ): Promise<ArtifactGenerationResult> {
    const initialGeneration = await this.generationGateway.generate({ prompt });
    const cleanedCandidate = this.extractMermaidContent(initialGeneration.text);
    return this.validateAndRepair(cleanedCandidate, options);
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

    // Step 1: Initial validation
    const initialValidation = await this.linterGateway.validate(currentCandidate);
    if (initialValidation.isValid) {
      return {
        content: currentCandidate,
        repairsNeeded: 0,
        repairHistory: [],
      };
    }

    // Candidate is invalid, record failure and enter repair loop
    repairHistory.push({
      attempt: 0,
      candidate: currentCandidate,
      errorMessage: initialValidation.errorMessage ?? 'Unknown validation error',
    });

    let repairAttempts = 0;
    while (repairAttempts < maxAttempts) {
      repairAttempts++;
      const lastError = repairHistory[repairHistory.length - 1].errorMessage;
      const repairPrompt = this.buildRepairPrompt(currentCandidate, lastError);

      const repairResult = await this.generationGateway.generate({
        prompt: repairPrompt,
      });

      currentCandidate = this.extractMermaidContent(repairResult.text);
      const validation = await this.linterGateway.validate(currentCandidate);

      if (validation.isValid) {
        return {
          content: currentCandidate,
          repairsNeeded: repairAttempts,
          repairHistory,
        };
      }

      repairHistory.push({
        attempt: repairAttempts,
        candidate: currentCandidate,
        errorMessage: validation.errorMessage ?? 'Unknown validation error',
      });
    }

    // If still invalid after max attempts, throw typed exhaustion failure
    const errorMessages = repairHistory.map(
      (h) => `Attempt ${h.attempt}: ${h.errorMessage}`
    );
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
