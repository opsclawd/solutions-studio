import {
  createStoryId,
  createRequirementsBaselineId,
  createRequirementRevisionId,
  createPolicyConstraintRevisionId,
  evaluateStoryReadiness,
  createStory,
  type Story,
  type StoryReadinessPolicy,
  type StoryReadinessReport,
  type StoryReadinessEvaluationContext,
  type RequirementRevision,
  type PolicyConstraintRevision
} from '@solutions-studio/domain';
import type { IRequirementsRepository } from '../ports/persistence/IRequirementsRepository.js';
import type { ISqlValidatorGateway } from '../ports/validation/ISqlValidatorGateway.js';
import type { IOpenApiValidatorGateway } from '../ports/validation/IOpenApiValidatorGateway.js';
import { UnknownStoryError } from './StoryProjectionErrors.js';

export interface EvaluateStoryReadinessInput {
  readonly storyId: string;
  readonly policy?: StoryReadinessPolicy;
}

export class EvaluateStoryReadinessUseCase {
  constructor(
    private readonly repository: IRequirementsRepository,
    private readonly sqlValidatorGateway?: ISqlValidatorGateway,
    private readonly openApiValidatorGateway?: IOpenApiValidatorGateway
  ) {}

  async execute(input: EvaluateStoryReadinessInput): Promise<StoryReadinessReport> {
    const storyId = createStoryId(input.storyId);
    const storyRecord = await this.repository.getStory(storyId);
    if (!storyRecord) {
      throw new UnknownStoryError(input.storyId);
    }

    const baseline = await this.repository.getRequirementsBaseline(storyRecord.baselineId);

    // Reconstruct domain Story entity
    const story: Story = createStory({
      id: storyRecord.id,
      baselineId: storyRecord.baselineId,
      title: storyRecord.title,
      narrative: storyRecord.narrative,
      requirementRevisionIds: storyRecord.requirementRevisionIds,
      policyConstraintRevisionIds: storyRecord.policyConstraintRevisionIds,
      scenarios: storyRecord.scenarios.map((s) => ({
        id: s.id,
        title: s.title,
        requirementRevisionIds: s.requirementRevisionIds,
        policyConstraintRevisionIds: s.policyConstraintRevisionIds,
        steps: s.steps,
        rawText: s.rawText
      })),
      acceptanceCriteria: storyRecord.acceptanceCriteria,
      gherkinText: storyRecord.gherkinText,
      dependencies: storyRecord.dependencies,
      createdAt: storyRecord.createdAt
    });

    // Gather all requirement revisions referenced by story and baseline
    const reqRevIdsToLoad = new Set<string>([
      ...story.requirementRevisionIds,
      ...(baseline?.requirementRevisions ?? [])
    ]);
    for (const sc of story.scenarios) {
      for (const r of sc.requirementRevisionIds) {
        reqRevIdsToLoad.add(r);
      }
    }

    const requirementRevisions: RequirementRevision[] = [];
    for (const rId of reqRevIdsToLoad) {
      const rev = await this.repository.getRequirementRevision(createRequirementRevisionId(rId));
      if (rev) {
        requirementRevisions.push(rev);
      }
    }

    // Gather all policy constraint revisions referenced by story and baseline
    const polRevIdsToLoad = new Set<string>([
      ...(story.policyConstraintRevisionIds ?? []),
      ...(baseline?.policyConstraintRevisions ?? [])
    ]);
    for (const sc of story.scenarios) {
      for (const p of sc.policyConstraintRevisionIds ?? []) {
        polRevIdsToLoad.add(p);
      }
    }

    const policyConstraintRevisions: PolicyConstraintRevision[] = [];
    for (const pId of polRevIdsToLoad) {
      const pol = await this.repository.getPolicyConstraintRevision(
        createPolicyConstraintRevisionId(pId)
      );
      if (pol) {
        policyConstraintRevisions.push(pol);
      }
    }

    // Load candidate findings and engineering decisions
    const candidateFindings = await this.repository.listCandidateFindings();
    const engineeringDecisions = await this.repository.listEngineeringDecisions({
      baselineId: story.baselineId
    });

    // Resolve projections for the story's baseline
    const projections = await this.repository.listProjectionRecords(story.baselineId);

    // Resolve latest SQL projection deterministically
    const sqlProjections = [...projections.filter((p) => p.artifactType === 'sql-schema')];
    sqlProjections.sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
    );

    let sqlProjectionValidation: StoryReadinessEvaluationContext['sqlProjectionValidation'];
    if (sqlProjections.length > 0) {
      const latestSql = sqlProjections[0];
      if (this.sqlValidatorGateway) {
        const valRes = await this.sqlValidatorGateway.validate(latestSql.content);
        sqlProjectionValidation = {
          exists: true,
          isValid: valRes.isValid,
          errorMessage: valRes.errorMessage,
          id: latestSql.id
        };
      } else {
        sqlProjectionValidation = {
          exists: true,
          isValid: true,
          id: latestSql.id
        };
      }
    } else {
      sqlProjectionValidation = {
        exists: false,
        isValid: input.policy?.requireSqlProjection !== true
      };
    }

    // Resolve latest OpenAPI projection deterministically
    const openApiProjections = [...projections.filter((p) => p.artifactType === 'openapi')];
    openApiProjections.sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
    );

    let openApiProjectionValidation: StoryReadinessEvaluationContext['openApiProjectionValidation'];
    if (openApiProjections.length > 0) {
      const latestOas = openApiProjections[0];
      if (this.openApiValidatorGateway) {
        const valRes = await this.openApiValidatorGateway.validate(latestOas.content);
        openApiProjectionValidation = {
          exists: true,
          isValid: valRes.isValid,
          errorMessage: valRes.errorMessage,
          id: latestOas.id
        };
      } else {
        openApiProjectionValidation = {
          exists: true,
          isValid: true,
          id: latestOas.id
        };
      }
    } else {
      openApiProjectionValidation = {
        exists: false,
        isValid: input.policy?.requireOpenApiProjection !== true
      };
    }

    // Fetch baseline story IDs
    const baselineStories = await this.repository.listStories(story.baselineId);
    const baselineStoryIds = baselineStories.map((s) => s.id);

    const context: StoryReadinessEvaluationContext = {
      story,
      baseline,
      requirementRevisions,
      policyConstraintRevisions,
      candidateFindings,
      engineeringDecisions,
      sqlProjectionValidation,
      openApiProjectionValidation,
      baselineStoryIds
    };

    return evaluateStoryReadiness(context, input.policy);
  }

  async executeForBaseline(
    baselineIdStr: string,
    policy?: StoryReadinessPolicy
  ): Promise<readonly StoryReadinessReport[]> {
    const baselineId = createRequirementsBaselineId(baselineIdStr);
    const stories = await this.repository.listStories(baselineId);
    const reports: StoryReadinessReport[] = [];
    for (const s of stories) {
      const report = await this.execute({ storyId: s.id, policy });
      reports.push(report);
    }
    return Object.freeze(reports);
  }
}
