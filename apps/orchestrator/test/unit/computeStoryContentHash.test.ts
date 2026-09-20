import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  computeStoryContentHash,
  computeStoryContentHashV1,
  computeStoryContentHashV2,
  matchesStoryContentHash,
  type StoryExportProjectionParams
} from '../../src/application/ports/backlog/computeStoryContentHash.js';
import {
  createStoryId,
  createRequirementsBaselineId,
  createRequirementRevisionId,
  createPolicyConstraintRevisionId,
  createEngineeringDecisionId
} from '@solutions-studio/domain';

describe('computeStoryContentHash', () => {
  it('computes deterministic SHA-256 hash matching createHash directly on gherkinText for legacy callers', () => {
    const gherkinText = 'Feature: Sample\nScenario: One\nGiven something\nWhen action\nThen result';
    const story = { gherkinText };

    const expectedHash = createHash('sha256').update(gherkinText).digest('hex');
    const computed = computeStoryContentHash(story);

    expect(computed).toBe(expectedHash);
    expect(computed).toHaveLength(64);
  });

  it('produces distinct hashes for differing gherkin text in simple mode', () => {
    const hash1 = computeStoryContentHash({ gherkinText: 'Feature: A' });
    const hash2 = computeStoryContentHash({ gherkinText: 'Feature: B' });

    expect(hash1).not.toBe(hash2);
  });

  describe('Canonical Export Projection Hashing & Mutation Invariance', () => {
    const baseParams: StoryExportProjectionParams = {
      story: {
        id: createStoryId('STORY-1'),
        title: 'User Authentication',
        narrative: { role: 'user', feature: 'login with credentials', benefit: 'gain access' },
        acceptanceCriteria: ['Valid credentials succeed', 'Invalid credentials locked out'],
        scenarios: [
          {
            title: 'Successful Login',
            requirementRevisionIds: [createRequirementRevisionId('REQ-1-R1')],
            steps: [
              { keyword: 'Given', text: 'user exists' },
              { keyword: 'When', text: 'correct password entered' },
              { keyword: 'Then', text: 'login succeeds' }
            ]
          }
        ],
        gherkinText: 'Feature: Login\nScenario: Successful Login\nGiven user exists',
        requirementRevisionIds: [createRequirementRevisionId('REQ-1-R1')],
        policyConstraintRevisionIds: [createPolicyConstraintRevisionId('POL-1-R1')]
      },
      baselineId: createRequirementsBaselineId('BASE-001'),
      engineeringDecisionIds: [createEngineeringDecisionId('DEC-001')],
      prerequisites: [
        { storyId: createStoryId('STORY-0'), externalWorkItemId: '41', title: 'Setup' }
      ]
    };

    it('produces deterministic hash for identical full projection inputs', () => {
      const hash1 = computeStoryContentHash(baseParams);
      const hash2 = computeStoryContentHash(baseParams);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('mutating story title produces distinct hash', () => {
      const modified: StoryExportProjectionParams = {
        ...baseParams,
        story: { ...baseParams.story, title: 'Mutated Story Title' }
      };
      expect(computeStoryContentHash(modified)).not.toBe(computeStoryContentHash(baseParams));
    });

    it('mutating story narrative produces distinct hash', () => {
      const modified: StoryExportProjectionParams = {
        ...baseParams,
        story: {
          ...baseParams.story,
          narrative: { role: 'admin', feature: 'login with credentials', benefit: 'manage users' }
        }
      };
      expect(computeStoryContentHash(modified)).not.toBe(computeStoryContentHash(baseParams));
    });

    it('mutating acceptance criteria produces distinct hash', () => {
      const modified: StoryExportProjectionParams = {
        ...baseParams,
        story: {
          ...baseParams.story,
          acceptanceCriteria: ['Additional acceptance criteria']
        }
      };
      expect(computeStoryContentHash(modified)).not.toBe(computeStoryContentHash(baseParams));
    });

    it('mutating scenarios produces distinct hash', () => {
      const modified: StoryExportProjectionParams = {
        ...baseParams,
        story: {
          ...baseParams.story,
          scenarios: [
            {
              title: 'Modified Scenario',
              requirementRevisionIds: [createRequirementRevisionId('REQ-1-R1')],
              steps: [{ keyword: 'Given', text: 'modified step' }]
            }
          ]
        }
      };
      expect(computeStoryContentHash(modified)).not.toBe(computeStoryContentHash(baseParams));
    });

    it('mutating baseline ID leaves computed content hash identical', () => {
      const modified: StoryExportProjectionParams = {
        ...baseParams,
        baselineId: createRequirementsBaselineId('BASE-002')
      };
      expect(computeStoryContentHash(modified)).toBe(computeStoryContentHash(baseParams));
    });

    it('mutating requirement revision IDs produces distinct hash', () => {
      const modified: StoryExportProjectionParams = {
        ...baseParams,
        story: {
          ...baseParams.story,
          requirementRevisionIds: [
            createRequirementRevisionId('REQ-1-R1'),
            createRequirementRevisionId('REQ-2-R1')
          ]
        }
      };
      expect(computeStoryContentHash(modified)).not.toBe(computeStoryContentHash(baseParams));
    });

    it('mutating policy constraint revision IDs produces distinct hash', () => {
      const modified: StoryExportProjectionParams = {
        ...baseParams,
        story: {
          ...baseParams.story,
          policyConstraintRevisionIds: [createPolicyConstraintRevisionId('POL-2-R1')]
        }
      };
      expect(computeStoryContentHash(modified)).not.toBe(computeStoryContentHash(baseParams));
    });

    it('mutating engineering decision IDs leaves computed content hash identical', () => {
      const modified: StoryExportProjectionParams = {
        ...baseParams,
        engineeringDecisionIds: [
          createEngineeringDecisionId('DEC-001'),
          createEngineeringDecisionId('DEC-002')
        ]
      };
      expect(computeStoryContentHash(modified)).toBe(computeStoryContentHash(baseParams));
    });

    it('mutating resolved prerequisite work item numbers produces distinct hash', () => {
      const modified: StoryExportProjectionParams = {
        ...baseParams,
        prerequisites: [
          { storyId: createStoryId('STORY-0'), externalWorkItemId: '42', title: 'Setup' }
        ]
      };
      expect(computeStoryContentHash(modified)).not.toBe(computeStoryContentHash(baseParams));
    });
  });

  describe('Phase 4 v1 Backward Compatibility and Hash Version Migration', () => {
    const v1Params: StoryExportProjectionParams = {
      story: {
        id: createStoryId('STORY-PHASE4'),
        title: 'Legacy Phase 4 Story',
        narrative: { role: 'analyst', feature: 'export', benefit: 'handoff' },
        acceptanceCriteria: ['Must export cleanly'],
        scenarios: [
          {
            title: 'Phase 4 Scenario',
            requirementRevisionIds: [createRequirementRevisionId('REQ-P4-R1')],
            steps: [{ keyword: 'Given', text: 'phase 4 state' }]
          }
        ],
        gherkinText: 'Feature: P4\nScenario: Phase 4 Scenario\nGiven phase 4 state',
        requirementRevisionIds: [createRequirementRevisionId('REQ-P4-R1')],
        policyConstraintRevisionIds: [createPolicyConstraintRevisionId('POL-P4-R1')]
      },
      baselineId: createRequirementsBaselineId('BASE-PHASE4-001'),
      engineeringDecisionIds: [createEngineeringDecisionId('DEC-P4-001')],
      prerequisites: [
        { storyId: createStoryId('STORY-P4-PRE'), externalWorkItemId: '100', title: 'Pre' }
      ]
    };

    it('v1 hash incorporates baselineId and engineeringDecisionIds', () => {
      const v1Hash = computeStoryContentHashV1(v1Params);
      const v2Hash = computeStoryContentHashV2(v1Params);

      expect(v1Hash).not.toBe(v2Hash);

      const modifiedBaseline = {
        ...v1Params,
        baselineId: createRequirementsBaselineId('BASE-PHASE4-002')
      };
      expect(computeStoryContentHashV1(modifiedBaseline)).not.toBe(v1Hash);
      expect(computeStoryContentHashV2(modifiedBaseline)).toBe(v2Hash);
    });

    it('matchesStoryContentHash correctly matches Phase 4 v1 mapping when exportContentHashVersion is 1', () => {
      const phase4V1Hash = computeStoryContentHashV1(v1Params);

      const isMatch = matchesStoryContentHash({
        mappingHash: phase4V1Hash,
        mappingHashVersion: 1,
        currentStory: v1Params.story,
        mappingBaselineId: v1Params.baselineId!,
        currentBaselineId: v1Params.baselineId!,
        engineeringDecisionIds: v1Params.engineeringDecisionIds,
        prerequisites: v1Params.prerequisites
      });
      expect(isMatch).toBe(true);
    });

    it('matchesStoryContentHash correctly matches v2 mapping even if baseline changes', () => {
      const v2Hash = computeStoryContentHashV2(v1Params);

      const isMatch = matchesStoryContentHash({
        mappingHash: v2Hash,
        mappingHashVersion: 2,
        currentStory: v1Params.story,
        mappingBaselineId: v1Params.baselineId!,
        currentBaselineId: createRequirementsBaselineId('BASE-NEW-999'),
        engineeringDecisionIds: [createEngineeringDecisionId('DEC-DIFF')],
        prerequisites: v1Params.prerequisites
      });
      expect(isMatch).toBe(true);
    });
  });
});
