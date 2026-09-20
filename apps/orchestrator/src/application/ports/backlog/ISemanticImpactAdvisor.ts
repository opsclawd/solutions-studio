import type {
  Story,
  RequirementsBaseline,
  AdvisorySemanticImpactResult
} from '@solutions-studio/domain';

/**
 * Advisory semantic impact advisor seam.
 * Strictly advisory: deterministic staleness must never depend on external AI calls,
 * and the seam remains optional / pluggable.
 * Any model-assisted impact inference is clearly advisory and cannot mutate/export by itself.
 */
export interface ISemanticImpactAdvisor {
  analyzeImpact(
    story: Story,
    baseline: RequirementsBaseline,
    previousBaseline?: RequirementsBaseline
  ): Promise<AdvisorySemanticImpactResult>;
}

export class MockSemanticImpactAdvisor implements ISemanticImpactAdvisor {
  async analyzeImpact(
    story: Story,
    baseline: RequirementsBaseline,
    _previousBaseline?: RequirementsBaseline
  ): Promise<AdvisorySemanticImpactResult> {
    return {
      isAdvisoryOnly: true,
      storyId: story.id,
      semanticRiskLevel: 'LOW',
      reasoning: `Story '${story.id}' analyzed against baseline '${baseline.id}'. Advisory only; no mutation.`,
      suggestedActions: ['Review story acceptance criteria'],
      modelAssisted: false
    };
  }
}
