import { createStory, type Story } from '@solutions-studio/domain';
import type { StoryRecord } from '../ports/persistence/IRequirementsRepository.js';

export function mapStoryRecordToDomainStory(record: StoryRecord): Story {
  const narrative =
    typeof record.narrative === 'string'
      ? {
          role: 'user',
          feature: record.narrative,
          benefit: 'business value',
          rawText: record.narrative
        }
      : {
          role: record.narrative?.role || 'user',
          feature: record.narrative?.feature || record.title || 'feature',
          benefit: record.narrative?.benefit || 'value',
          rawText: record.narrative?.rawText
        };

  const scenarios =
    record.scenarios && record.scenarios.length > 0
      ? record.scenarios.map((s) => ({
          id: s.id,
          title: s.title,
          requirementRevisionIds: s.requirementRevisionIds,
          policyConstraintRevisionIds: s.policyConstraintRevisionIds,
          steps:
            s.steps && s.steps.length > 0
              ? s.steps
              : [{ keyword: 'Given' as const, text: 'precondition' }],
          rawText: s.rawText
        }))
      : [
          {
            title: 'Default scenario',
            requirementRevisionIds: record.requirementRevisionIds,
            policyConstraintRevisionIds: record.policyConstraintRevisionIds,
            steps: [{ keyword: 'Given' as const, text: 'precondition' }]
          }
        ];

  return createStory({
    id: record.id,
    baselineId: record.baselineId,
    title: record.title,
    narrative,
    requirementRevisionIds: record.requirementRevisionIds,
    policyConstraintRevisionIds: record.policyConstraintRevisionIds,
    scenarios,
    acceptanceCriteria:
      record.acceptanceCriteria && record.acceptanceCriteria.length > 0
        ? record.acceptanceCriteria
        : ['AC1'],
    gherkinText: record.gherkinText,
    dependencies: record.dependencies,
    version: record.version,
    createdAt: record.createdAt
  });
}
