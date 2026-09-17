import type { EvaluationFixtureDto, SourceLineageMapEntryDto } from '@solutions-studio/contracts';
import type {
  IGenerationGateway,
  GenerationRequest,
  GenerationResult
} from '../../application/ports/generation/IGenerationGateway.js';

export interface FixtureReplayRegistration {
  readonly fixture: EvaluationFixtureDto;
  readonly lineageEntries: readonly SourceLineageMapEntryDto[];
  readonly expectedCapturedIds: readonly string[];
}

export class FixtureReplayPromptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FixtureReplayPromptError';
  }
}

export class FixtureReplayGenerationGateway implements IGenerationGateway {
  private readonly registrations = new Map<string, FixtureReplayRegistration>();
  private readonly executedFixtures = new Set<string>();

  constructor(initialRegistrations?: readonly FixtureReplayRegistration[]) {
    if (initialRegistrations) {
      for (const reg of initialRegistrations) {
        this.registerFixture(reg);
      }
    }
  }

  registerFixture(registration: FixtureReplayRegistration): void {
    this.registrations.set(registration.fixture.fixtureId, registration);
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const prompt = request.prompt;
    const matches = [...prompt.matchAll(/### Source Revision:\s*([^\r\n]+)/g)];

    if (matches.length === 0) {
      throw new FixtureReplayPromptError(
        'Replay gateway rejected prompt: no "### Source Revision:" headings found'
      );
    }

    const promptCapturedIds = matches.map((m) => m[1].trim());

    // Check for duplicate source revisions in prompt
    const uniquePromptIds = new Set(promptCapturedIds);
    if (uniquePromptIds.size !== promptCapturedIds.length) {
      throw new FixtureReplayPromptError(
        'Replay gateway rejected prompt: duplicate source revision headings detected in prompt'
      );
    }

    // Resolve exact matching registered fixture
    let matchedReg: FixtureReplayRegistration | undefined = undefined;

    for (const reg of this.registrations.values()) {
      if (reg.expectedCapturedIds.length !== promptCapturedIds.length) {
        continue;
      }

      const isExactMatch = reg.expectedCapturedIds.every(
        (id, index) => id === promptCapturedIds[index]
      );

      if (isExactMatch) {
        if (matchedReg) {
          throw new FixtureReplayPromptError(
            `Ambiguous prompt: matches multiple registered fixtures ('${matchedReg.fixture.fixtureId}' and '${reg.fixture.fixtureId}')`
          );
        }
        matchedReg = reg;
      }
    }

    if (!matchedReg) {
      throw new FixtureReplayPromptError(
        `Replay gateway rejected prompt: source revision set [${promptCapturedIds.join(', ')}] does not match any registered fixture`
      );
    }

    if (this.executedFixtures.has(matchedReg.fixture.fixtureId)) {
      throw new FixtureReplayPromptError(
        `Replay gateway rejected prompt: duplicate compile prompt for fixture '${matchedReg.fixture.fixtureId}'`
      );
    }

    this.executedFixtures.add(matchedReg.fixture.fixtureId);

    const declaredToCapturedMap = new Map<string, string>();
    for (const entry of matchedReg.lineageEntries) {
      declaredToCapturedMap.set(entry.declaredRevisionId, entry.capturedRevisionId);
    }

    // Build deterministic scripted response from ground truth
    const requirements = matchedReg.fixture.expectedRequirements.map((r) => ({
      requirementKey: r.requirementKey,
      statement: `Statement for ${r.requirementKey}`,
      category: r.category,
      origin: r.origin,
      evidence: r.evidence.map((e) => {
        const capturedId = declaredToCapturedMap.get(e.sourceRevisionId);
        if (!capturedId) {
          throw new FixtureReplayPromptError(
            `Unresolvable declared alias '${e.sourceRevisionId}' in fixture '${matchedReg!.fixture.fixtureId}'`
          );
        }
        return {
          sourceRevisionId: capturedId,
          locator: e.locator
        };
      }),
      rationale: `Replay rationale for ${r.requirementKey}`
    }));

    const findings = matchedReg.fixture.expectedFindings.map((f) => ({
      findingKey: f.findingKey,
      type: f.type,
      relatedRequirementKeys: [...f.relatedRequirementKeys],
      evidence: f.evidence.map((e) => {
        const capturedId = declaredToCapturedMap.get(e.sourceRevisionId);
        if (!capturedId) {
          throw new FixtureReplayPromptError(
            `Unresolvable declared alias '${e.sourceRevisionId}' in fixture '${matchedReg!.fixture.fixtureId}'`
          );
        }
        return {
          sourceRevisionId: capturedId,
          locator: e.locator
        };
      }),
      rationale: f.rationale ?? `Replay finding rationale for ${f.findingKey}`
    }));

    const responsePayload = {
      requirements,
      findings
    };

    return {
      text: JSON.stringify(responsePayload, null, 2),
      metadata: {
        provider: 'fixture-replay',
        model: 'fixture-replay-v1',
        durationMs: 5,
        tokens: {
          input: 100,
          output: 100,
          total: 200
        }
      }
    };
  }
}
