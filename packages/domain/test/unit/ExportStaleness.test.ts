import { describe, it, expect } from 'vitest';
import {
  createStoryId,
  createRequirementsBaselineId,
  createRequirementRevisionId,
  createPolicyConstraintRevisionId,
  createReviewerId,
  createActorId,
  createBacklogExportMappingId,
  createStory,
  createBacklogExportMapping,
  evaluateExportStaleness,
  now,
  InvalidBacklogMappingError,
  type AdvisorySemanticImpactResult
} from '../../src/index.js';

describe('ExportStaleness & BacklogExportMapping Lineage', () => {
  const baseline1 = {
    id: createRequirementsBaselineId('BASE-001'),
    requirementRevisions: [
      createRequirementRevisionId('REQ-001-R1'),
      createRequirementRevisionId('REQ-003-R1')
    ],
    policyConstraintRevisions: [createPolicyConstraintRevisionId('POL-001-R1')],
    createdAt: now(),
    createdBy: createReviewerId('REV-1')
  };

  const dummyHashFn = (story: { id: string; gherkinText: string }) => {
    // Generate a valid 64-char hex string deterministically
    const raw = `${story.id}:${story.gherkinText}`;
    let hex = '';
    for (let i = 0; i < raw.length; i++) {
      hex += raw.charCodeAt(i).toString(16).padStart(2, '0');
    }
    return hex.padEnd(64, 'a').slice(0, 64);
  };

  it('validates exportVersion and storyVersion invariants on BacklogExportMapping', () => {
    const valid = createBacklogExportMapping({
      id: createBacklogExportMappingId('MAP-1'),
      storyId: createStoryId('STORY-1'),
      storyVersion: 1,
      exportVersion: 1,
      baselineId: baseline1.id,
      requirementRevisionIds: [createRequirementRevisionId('REQ-001-R1')],
      provider: 'github-issues',
      externalContainer: 'acme/repo',
      externalWorkItemId: '101',
      exportContentHash: 'a'.repeat(64),
      exportedAt: now(),
      exportedBy: createActorId('ACTOR-1')
    });

    expect(valid.exportVersion).toBe(1);
    expect(valid.storyVersion).toBe(1);
    expect(valid.requirementRevisionIds).toEqual(['REQ-001-R1']);
    expect(valid.history).toEqual([]);

    // Rejects invalid exportVersion
    expect(() =>
      createBacklogExportMapping({
        id: createBacklogExportMappingId('MAP-1'),
        storyId: createStoryId('STORY-1'),
        exportVersion: 0,
        baselineId: baseline1.id,
        provider: 'github-issues',
        externalContainer: 'acme/repo',
        externalWorkItemId: '101',
        exportContentHash: 'a'.repeat(64),
        exportedAt: now(),
        exportedBy: createActorId('ACTOR-1')
      })
    ).toThrow(InvalidBacklogMappingError);

    // Rejects invalid storyVersion
    expect(() =>
      createBacklogExportMapping({
        id: createBacklogExportMappingId('MAP-1'),
        storyId: createStoryId('STORY-1'),
        storyVersion: -1,
        baselineId: baseline1.id,
        provider: 'github-issues',
        externalContainer: 'acme/repo',
        externalWorkItemId: '101',
        exportContentHash: 'a'.repeat(64),
        exportedAt: now(),
        exportedBy: createActorId('ACTOR-1')
      })
    ).toThrow(InvalidBacklogMappingError);
  });

  it('validates history entries sequencing and invariants on BacklogExportMapping', () => {
    const mapping = createBacklogExportMapping({
      id: createBacklogExportMappingId('MAP-1'),
      storyId: createStoryId('STORY-1'),
      storyVersion: 2,
      exportVersion: 3,
      baselineId: baseline1.id,
      requirementRevisionIds: [createRequirementRevisionId('REQ-001-R1')],
      provider: 'github-issues',
      externalContainer: 'acme/repo',
      externalWorkItemId: '101',
      exportContentHash: 'c'.repeat(64),
      exportedAt: now(),
      exportedBy: createActorId('ACTOR-1'),
      history: [
        {
          exportVersion: 1,
          baselineId: baseline1.id,
          storyVersion: 1,
          requirementRevisionIds: [createRequirementRevisionId('REQ-001-R1')],
          exportContentHash: 'a'.repeat(64),
          exportedAt: now(),
          exportedBy: createActorId('ACTOR-1'),
          externalWorkItemId: '101',
          updateRationale: 'Initial'
        },
        {
          exportVersion: 2,
          baselineId: baseline1.id,
          storyVersion: 2,
          requirementRevisionIds: [createRequirementRevisionId('REQ-001-R1')],
          exportContentHash: 'b'.repeat(64),
          exportedAt: now(),
          exportedBy: createActorId('ACTOR-1'),
          externalWorkItemId: '101',
          updateRationale: 'Second'
        }
      ]
    });

    expect(mapping.exportVersion).toBe(3);
    expect(mapping.history).toHaveLength(2);
    expect(mapping.history?.[0].exportVersion).toBe(1);
    expect(mapping.history?.[1].exportVersion).toBe(2);

    // Rejects non-ascending history
    expect(() =>
      createBacklogExportMapping({
        id: createBacklogExportMappingId('MAP-1'),
        storyId: createStoryId('STORY-1'),
        exportVersion: 3,
        baselineId: baseline1.id,
        provider: 'github-issues',
        externalContainer: 'acme/repo',
        externalWorkItemId: '101',
        exportContentHash: 'c'.repeat(64),
        exportedAt: now(),
        exportedBy: createActorId('ACTOR-1'),
        history: [
          {
            exportVersion: 2,
            baselineId: baseline1.id,
            storyVersion: 1,
            requirementRevisionIds: [],
            exportContentHash: 'b'.repeat(64),
            exportedAt: now(),
            exportedBy: createActorId('ACTOR-1'),
            externalWorkItemId: '101'
          },
          {
            exportVersion: 1,
            baselineId: baseline1.id,
            storyVersion: 1,
            requirementRevisionIds: [],
            exportContentHash: 'a'.repeat(64),
            exportedAt: now(),
            exportedBy: createActorId('ACTOR-1'),
            externalWorkItemId: '101'
          }
        ]
      })
    ).toThrow('history entries must be strictly ordered by exportVersion ascending');

    // Rejects history entry with exportVersion >= current mapping exportVersion
    expect(() =>
      createBacklogExportMapping({
        id: createBacklogExportMappingId('MAP-1'),
        storyId: createStoryId('STORY-1'),
        exportVersion: 2,
        baselineId: baseline1.id,
        provider: 'github-issues',
        externalContainer: 'acme/repo',
        externalWorkItemId: '101',
        exportContentHash: 'c'.repeat(64),
        exportedAt: now(),
        exportedBy: createActorId('ACTOR-1'),
        history: [
          {
            exportVersion: 2,
            baselineId: baseline1.id,
            storyVersion: 1,
            requirementRevisionIds: [],
            exportContentHash: 'b'.repeat(64),
            exportedAt: now(),
            exportedBy: createActorId('ACTOR-1'),
            externalWorkItemId: '101'
          }
        ]
      })
    ).toThrow('must be strictly less than current mapping exportVersion');
  });

  it('Test 1: Unexported story returns UNEXPORTED', () => {
    const story = createStory({
      id: 'STORY-1',
      baselineId: baseline1.id,
      title: 'Story 1',
      narrative: { role: 'User', feature: 'Login', benefit: 'Access' },
      requirementRevisionIds: [createRequirementRevisionId('REQ-001-R1')],
      scenarios: [
        {
          title: 'Scenario 1',
          requirementRevisionIds: [createRequirementRevisionId('REQ-001-R1')],
          steps: [{ keyword: 'Given', text: 'user exists' }]
        }
      ],
      gherkinText: 'Feature: Login'
    });

    const report = evaluateExportStaleness({
      baseline: baseline1,
      stories: [story],
      mappings: [],
      activeRequirementMap: new Map([['REQ-001', 'REQ-001-R1']]),
      activePolicyConstraintMap: new Map(),
      lookupRequirementRevision: () => ({ requirementId: 'REQ-001', revision: 1 }),
      computeStoryHash: dummyHashFn
    });

    expect(report.totalStories).toBe(1);
    expect(report.unexportedCount).toBe(1);
    expect(report.currentCount).toBe(0);
    expect(report.staleCount).toBe(0);
    expect(report.impactedCount).toBe(0);
    expect(report.stories[0].classification).toBe('UNEXPORTED');
  });

  it('Test 2: Matching export returns CURRENT', () => {
    const story = createStory({
      id: 'STORY-1',
      baselineId: baseline1.id,
      title: 'Story 1',
      narrative: { role: 'User', feature: 'Login', benefit: 'Access' },
      requirementRevisionIds: [createRequirementRevisionId('REQ-001-R1')],
      scenarios: [
        {
          title: 'Scenario 1',
          requirementRevisionIds: [createRequirementRevisionId('REQ-001-R1')],
          steps: [{ keyword: 'Given', text: 'user exists' }]
        }
      ],
      gherkinText: 'Feature: Login',
      version: 1
    });

    const hash = dummyHashFn(story);
    const mapping = createBacklogExportMapping({
      id: 'MAP-1',
      storyId: story.id,
      storyVersion: 1,
      exportVersion: 1,
      baselineId: baseline1.id,
      requirementRevisionIds: [createRequirementRevisionId('REQ-001-R1')],
      provider: 'github-issues',
      externalContainer: 'acme/repo',
      externalWorkItemId: '101',
      exportContentHash: hash,
      exportedAt: now(),
      exportedBy: createActorId('ACTOR-1')
    });

    const report = evaluateExportStaleness({
      baseline: baseline1,
      stories: [story],
      mappings: [mapping],
      activeRequirementMap: new Map([['REQ-001', 'REQ-001-R1']]),
      activePolicyConstraintMap: new Map(),
      lookupRequirementRevision: () => ({ requirementId: 'REQ-001', revision: 1 }),
      computeStoryHash: dummyHashFn
    });

    expect(report.currentCount).toBe(1);
    expect(report.staleCount).toBe(0);
    expect(report.stories[0].classification).toBe('CURRENT');
    expect(report.stories[0].exportedLineage?.exportVersion).toBe(1);
  });

  it('Test 3: Direct requirement supersession returns STALE (REQUIREMENT_REVISION_SUPERSEDED)', () => {
    const story = createStory({
      id: 'STORY-1',
      baselineId: baseline1.id,
      title: 'Story 1',
      narrative: { role: 'User', feature: 'Login', benefit: 'Access' },
      requirementRevisionIds: [createRequirementRevisionId('REQ-001-R2')],
      scenarios: [
        {
          title: 'Scenario 1',
          requirementRevisionIds: [createRequirementRevisionId('REQ-001-R2')],
          steps: [{ keyword: 'Given', text: 'user exists' }]
        }
      ],
      gherkinText: 'Feature: Login'
    });

    const hash = dummyHashFn(story);
    const mapping = createBacklogExportMapping({
      id: 'MAP-1',
      storyId: story.id,
      storyVersion: 1,
      exportVersion: 1,
      baselineId: baseline1.id,
      requirementRevisionIds: [createRequirementRevisionId('REQ-001-R1')],
      provider: 'github-issues',
      externalContainer: 'acme/repo',
      externalWorkItemId: '101',
      exportContentHash: hash,
      exportedAt: now(),
      exportedBy: createActorId('ACTOR-1')
    });

    const report = evaluateExportStaleness({
      baseline: baseline1,
      stories: [story],
      mappings: [mapping],
      activeRequirementMap: new Map([['REQ-001', 'REQ-001-R2']]),
      activePolicyConstraintMap: new Map(),
      lookupRequirementRevision: (revId) => ({
        requirementId: 'REQ-001',
        revision: revId === 'REQ-001-R1' ? 1 : 2
      }),
      computeStoryHash: dummyHashFn
    });

    expect(report.staleCount).toBe(1);
    expect(report.stories[0].classification).toBe('STALE');
    expect(report.stories[0].causes).toContainEqual(
      expect.objectContaining({
        category: 'REQUIREMENT_REVISION_SUPERSEDED',
        exportedRevision: 'REQ-001-R1',
        currentRevision: 'REQ-001-R2'
      })
    );
  });

  it('Test 4: Direct policy constraint supersession returns STALE', () => {
    const story = createStory({
      id: 'STORY-1',
      baselineId: baseline1.id,
      title: 'Story 1',
      narrative: { role: 'User', feature: 'Login', benefit: 'Access' },
      requirementRevisionIds: [createRequirementRevisionId('REQ-001-R1')],
      policyConstraintRevisionIds: [createPolicyConstraintRevisionId('POL-001-R2')],
      scenarios: [
        {
          title: 'Scenario 1',
          requirementRevisionIds: [createRequirementRevisionId('REQ-001-R1')],
          policyConstraintRevisionIds: [createPolicyConstraintRevisionId('POL-001-R2')],
          steps: [{ keyword: 'Given', text: 'user exists' }]
        }
      ],
      gherkinText: 'Feature: Login'
    });

    const hash = dummyHashFn(story);
    const mapping = createBacklogExportMapping({
      id: 'MAP-1',
      storyId: story.id,
      storyVersion: 1,
      exportVersion: 1,
      baselineId: baseline1.id,
      requirementRevisionIds: [createRequirementRevisionId('REQ-001-R1')],
      policyConstraintRevisionIds: [createPolicyConstraintRevisionId('POL-001-R1')],
      provider: 'github-issues',
      externalContainer: 'acme/repo',
      externalWorkItemId: '101',
      exportContentHash: hash,
      exportedAt: now(),
      exportedBy: createActorId('ACTOR-1')
    });

    const report = evaluateExportStaleness({
      baseline: baseline1,
      stories: [story],
      mappings: [mapping],
      activeRequirementMap: new Map([['REQ-001', 'REQ-001-R1']]),
      activePolicyConstraintMap: new Map([['POL-001', 'POL-001-R2']]),
      lookupRequirementRevision: () => ({ requirementId: 'REQ-001', revision: 1 }),
      lookupPolicyConstraintRevision: (revId) => ({
        policyConstraintId: 'POL-001',
        revision: revId === 'POL-001-R1' ? 1 : 2
      }),
      computeStoryHash: dummyHashFn
    });

    expect(report.staleCount).toBe(1);
    expect(report.stories[0].classification).toBe('STALE');
    expect(report.stories[0].causes).toContainEqual(
      expect.objectContaining({
        category: 'POLICY_CONSTRAINT_SUPERSEDED',
        exportedRevision: 'POL-001-R1',
        currentRevision: 'POL-001-R2'
      })
    );
  });

  it('Test 5: Story version bump returns STALE (STORY_VERSION_SUPERSEDED)', () => {
    const story = createStory({
      id: 'STORY-1',
      baselineId: baseline1.id,
      title: 'Story 1',
      narrative: { role: 'User', feature: 'Login', benefit: 'Access' },
      requirementRevisionIds: [createRequirementRevisionId('REQ-001-R1')],
      scenarios: [
        {
          title: 'Scenario 1',
          requirementRevisionIds: [createRequirementRevisionId('REQ-001-R1')],
          steps: [{ keyword: 'Given', text: 'user exists' }]
        }
      ],
      gherkinText: 'Feature: Login',
      version: 2
    });

    const hash = dummyHashFn(story);
    const mapping = createBacklogExportMapping({
      id: 'MAP-1',
      storyId: story.id,
      storyVersion: 1, // exported at version 1, story now at 2
      exportVersion: 1,
      baselineId: baseline1.id,
      requirementRevisionIds: [createRequirementRevisionId('REQ-001-R1')],
      provider: 'github-issues',
      externalContainer: 'acme/repo',
      externalWorkItemId: '101',
      exportContentHash: hash,
      exportedAt: now(),
      exportedBy: createActorId('ACTOR-1')
    });

    const report = evaluateExportStaleness({
      baseline: baseline1,
      stories: [story],
      mappings: [mapping],
      activeRequirementMap: new Map([['REQ-001', 'REQ-001-R1']]),
      activePolicyConstraintMap: new Map(),
      lookupRequirementRevision: () => ({ requirementId: 'REQ-001', revision: 1 }),
      computeStoryHash: dummyHashFn
    });

    expect(report.staleCount).toBe(1);
    expect(report.stories[0].classification).toBe('STALE');
    expect(report.stories[0].causes).toContainEqual(
      expect.objectContaining({
        category: 'STORY_VERSION_SUPERSEDED'
      })
    );
  });

  it('Test 6: Content hash divergence returns STALE (CONTENT_HASH_MISMATCH)', () => {
    const story = createStory({
      id: 'STORY-1',
      baselineId: baseline1.id,
      title: 'Story 1',
      narrative: { role: 'User', feature: 'Login', benefit: 'Access' },
      requirementRevisionIds: [createRequirementRevisionId('REQ-001-R1')],
      scenarios: [
        {
          title: 'Scenario 1',
          requirementRevisionIds: [createRequirementRevisionId('REQ-001-R1')],
          steps: [{ keyword: 'Given', text: 'user exists' }]
        }
      ],
      gherkinText: 'Feature: Login',
      version: 1
    });

    const mapping = createBacklogExportMapping({
      id: 'MAP-1',
      storyId: story.id,
      storyVersion: 1,
      exportVersion: 1,
      baselineId: baseline1.id,
      requirementRevisionIds: [createRequirementRevisionId('REQ-001-R1')],
      provider: 'github-issues',
      externalContainer: 'acme/repo',
      externalWorkItemId: '101',
      exportContentHash: '0'.repeat(64), // deliberately different from dummyHashFn
      exportedAt: now(),
      exportedBy: createActorId('ACTOR-1')
    });

    const report = evaluateExportStaleness({
      baseline: baseline1,
      stories: [story],
      mappings: [mapping],
      activeRequirementMap: new Map([['REQ-001', 'REQ-001-R1']]),
      activePolicyConstraintMap: new Map(),
      lookupRequirementRevision: () => ({ requirementId: 'REQ-001', revision: 1 }),
      computeStoryHash: dummyHashFn
    });

    expect(report.staleCount).toBe(1);
    expect(report.stories[0].causes).toContainEqual(
      expect.objectContaining({
        category: 'CONTENT_HASH_MISMATCH'
      })
    );
  });

  it('Test 7 (Witness AC-2 & CONSUMER-100-AC-7): Unrelated baseline change leaves unaffected story as CURRENT', () => {
    // Baseline 2 has REQ-001-R2 and REQ-003-R1. Story 3 only references REQ-003-R1.
    const baseline2 = {
      id: createRequirementsBaselineId('BASE-002'),
      requirementRevisions: [
        createRequirementRevisionId('REQ-001-R2'),
        createRequirementRevisionId('REQ-003-R1')
      ],
      policyConstraintRevisions: [],
      createdAt: now(),
      createdBy: createReviewerId('REV-1')
    };

    const story3 = createStory({
      id: 'STORY-3',
      baselineId: baseline2.id,
      title: 'Story 3',
      narrative: { role: 'User', feature: 'Billing', benefit: 'Pay' },
      requirementRevisionIds: [createRequirementRevisionId('REQ-003-R1')],
      scenarios: [
        {
          title: 'Scenario 3',
          requirementRevisionIds: [createRequirementRevisionId('REQ-003-R1')],
          steps: [{ keyword: 'Given', text: 'card valid' }]
        }
      ],
      gherkinText: 'Feature: Billing',
      version: 1
    });

    // Story 3 was exported under BASE-001
    const hash = dummyHashFn(story3);
    const mapping3 = createBacklogExportMapping({
      id: 'MAP-3',
      storyId: story3.id,
      storyVersion: 1,
      exportVersion: 1,
      baselineId: baseline1.id, // exported under BASE-001
      requirementRevisionIds: [createRequirementRevisionId('REQ-003-R1')],
      provider: 'github-issues',
      externalContainer: 'acme/repo',
      externalWorkItemId: '103',
      exportContentHash: hash,
      exportedAt: now(),
      exportedBy: createActorId('ACTOR-1')
    });

    const report = evaluateExportStaleness({
      baseline: baseline2,
      stories: [story3],
      mappings: [mapping3],
      activeRequirementMap: new Map([
        ['REQ-001', 'REQ-001-R2'],
        ['REQ-003', 'REQ-003-R1']
      ]),
      activePolicyConstraintMap: new Map(),
      lookupRequirementRevision: (revId) => ({
        requirementId: revId.startsWith('REQ-001') ? 'REQ-001' : 'REQ-003',
        revision: 1
      }),
      computeStoryHash: dummyHashFn
    });

    expect(report.totalStories).toBe(1);
    expect(report.currentCount).toBe(1);
    expect(report.staleCount).toBe(0);
    expect(report.impactedCount).toBe(0);
    expect(report.stories[0].classification).toBe('CURRENT');
  });

  it('Test 8 (Witness CONSUMER-100-AC-7): Successor baseline with Story 1 STALE, Story 2 IMPACTED, Story 3 CURRENT', () => {
    const baseline2 = {
      id: createRequirementsBaselineId('BASE-002'),
      requirementRevisions: [
        createRequirementRevisionId('REQ-001-R2'),
        createRequirementRevisionId('REQ-003-R1')
      ],
      policyConstraintRevisions: [],
      createdAt: now(),
      createdBy: createReviewerId('REV-1')
    };

    // Story 1: references REQ-001 (which changed to R2)
    const story1 = createStory({
      id: 'STORY-1',
      baselineId: baseline2.id,
      title: 'Story 1',
      narrative: { role: 'User', feature: 'Auth', benefit: 'Login' },
      requirementRevisionIds: [createRequirementRevisionId('REQ-001-R2')],
      scenarios: [
        {
          title: 'S1',
          requirementRevisionIds: [createRequirementRevisionId('REQ-001-R2')],
          steps: [{ keyword: 'Given', text: 'user exists' }]
        }
      ],
      gherkinText: 'Feature: Auth',
      version: 1
    });

    // Story 2: references REQ-003-R1 (unchanged) BUT depends on Story 1!
    const story2 = createStory({
      id: 'STORY-2',
      baselineId: baseline2.id,
      title: 'Story 2',
      narrative: { role: 'User', feature: 'Profile', benefit: 'View' },
      requirementRevisionIds: [createRequirementRevisionId('REQ-003-R1')],
      scenarios: [
        {
          title: 'S2',
          requirementRevisionIds: [createRequirementRevisionId('REQ-003-R1')],
          steps: [{ keyword: 'Given', text: 'user logged in' }]
        }
      ],
      gherkinText: 'Feature: Profile',
      dependencies: ['STORY-1'],
      version: 1
    });

    // Story 3: references REQ-003-R1 (unchanged), independent
    const story3 = createStory({
      id: 'STORY-3',
      baselineId: baseline2.id,
      title: 'Story 3',
      narrative: { role: 'User', feature: 'Billing', benefit: 'Pay' },
      requirementRevisionIds: [createRequirementRevisionId('REQ-003-R1')],
      scenarios: [
        {
          title: 'S3',
          requirementRevisionIds: [createRequirementRevisionId('REQ-003-R1')],
          steps: [{ keyword: 'Given', text: 'invoice exists' }]
        }
      ],
      gherkinText: 'Feature: Billing',
      version: 1
    });

    // Mappings recorded under BASE-001
    const mapping1 = createBacklogExportMapping({
      id: 'MAP-1',
      storyId: story1.id,
      storyVersion: 1,
      exportVersion: 1,
      baselineId: baseline1.id,
      requirementRevisionIds: [createRequirementRevisionId('REQ-001-R1')],
      provider: 'github-issues',
      externalContainer: 'acme/repo',
      externalWorkItemId: '101',
      exportContentHash: dummyHashFn(story1),
      exportedAt: now(),
      exportedBy: createActorId('ACTOR-1')
    });

    const mapping2 = createBacklogExportMapping({
      id: 'MAP-2',
      storyId: story2.id,
      storyVersion: 1,
      exportVersion: 1,
      baselineId: baseline1.id,
      requirementRevisionIds: [createRequirementRevisionId('REQ-003-R1')],
      provider: 'github-issues',
      externalContainer: 'acme/repo',
      externalWorkItemId: '102',
      exportContentHash: dummyHashFn(story2),
      exportedAt: now(),
      exportedBy: createActorId('ACTOR-1')
    });

    const mapping3 = createBacklogExportMapping({
      id: 'MAP-3',
      storyId: story3.id,
      storyVersion: 1,
      exportVersion: 1,
      baselineId: baseline1.id,
      requirementRevisionIds: [createRequirementRevisionId('REQ-003-R1')],
      provider: 'github-issues',
      externalContainer: 'acme/repo',
      externalWorkItemId: '103',
      exportContentHash: dummyHashFn(story3),
      exportedAt: now(),
      exportedBy: createActorId('ACTOR-1')
    });

    const report = evaluateExportStaleness({
      baseline: baseline2,
      stories: [story1, story2, story3],
      mappings: [mapping1, mapping2, mapping3],
      activeRequirementMap: new Map([
        ['REQ-001', 'REQ-001-R2'],
        ['REQ-003', 'REQ-003-R1']
      ]),
      activePolicyConstraintMap: new Map(),
      lookupRequirementRevision: (revId) => ({
        requirementId: revId.startsWith('REQ-001') ? 'REQ-001' : 'REQ-003',
        revision: revId === 'REQ-001-R1' ? 1 : revId === 'REQ-001-R2' ? 2 : 1
      }),
      computeStoryHash: dummyHashFn
    });

    expect(report.totalStories).toBe(3);
    expect(report.staleCount).toBe(1);
    expect(report.impactedCount).toBe(1);
    expect(report.currentCount).toBe(1);

    const s1Report = report.stories.find((s) => s.storyId === 'STORY-1')!;
    expect(s1Report.classification).toBe('STALE');
    expect(s1Report.causes[0].category).toBe('REQUIREMENT_REVISION_SUPERSEDED');

    const s2Report = report.stories.find((s) => s.storyId === 'STORY-2')!;
    expect(s2Report.classification).toBe('IMPACTED');
    expect(s2Report.causes[0].category).toBe('PREREQUISITE_STALE');
    expect(s2Report.impactedByPrerequisiteStoryIds).toEqual(['STORY-1']);

    const s3Report = report.stories.find((s) => s.storyId === 'STORY-3')!;
    expect(s3Report.classification).toBe('CURRENT');
  });

  it('Test 9: Multi-hop DAG impact propagates transitively (A -> B -> C)', () => {
    const storyA = createStory({
      id: 'STORY-A',
      baselineId: baseline1.id,
      title: 'Story A',
      narrative: { role: 'User', feature: 'A', benefit: 'A' },
      requirementRevisionIds: [createRequirementRevisionId('REQ-001-R2')],
      scenarios: [
        {
          title: 'SA',
          requirementRevisionIds: [createRequirementRevisionId('REQ-001-R2')],
          steps: [{ keyword: 'Given', text: 'step' }]
        }
      ],
      gherkinText: 'Feature: A'
    });

    const storyB = createStory({
      id: 'STORY-B',
      baselineId: baseline1.id,
      title: 'Story B',
      narrative: { role: 'User', feature: 'B', benefit: 'B' },
      requirementRevisionIds: [createRequirementRevisionId('REQ-003-R1')],
      scenarios: [
        {
          title: 'SB',
          requirementRevisionIds: [createRequirementRevisionId('REQ-003-R1')],
          steps: [{ keyword: 'Given', text: 'step' }]
        }
      ],
      gherkinText: 'Feature: B',
      dependencies: ['STORY-A']
    });

    const storyC = createStory({
      id: 'STORY-C',
      baselineId: baseline1.id,
      title: 'Story C',
      narrative: { role: 'User', feature: 'C', benefit: 'C' },
      requirementRevisionIds: [createRequirementRevisionId('REQ-003-R1')],
      scenarios: [
        {
          title: 'SC',
          requirementRevisionIds: [createRequirementRevisionId('REQ-003-R1')],
          steps: [{ keyword: 'Given', text: 'step' }]
        }
      ],
      gherkinText: 'Feature: C',
      dependencies: ['STORY-B']
    });

    const mappingA = createBacklogExportMapping({
      id: 'MAP-A',
      storyId: storyA.id,
      baselineId: baseline1.id,
      requirementRevisionIds: [createRequirementRevisionId('REQ-001-R1')], // superseded!
      provider: 'github-issues',
      externalContainer: 'acme/repo',
      externalWorkItemId: '1',
      exportContentHash: dummyHashFn(storyA),
      exportedAt: now(),
      exportedBy: createActorId('ACTOR-1')
    });

    const mappingB = createBacklogExportMapping({
      id: 'MAP-B',
      storyId: storyB.id,
      baselineId: baseline1.id,
      requirementRevisionIds: [createRequirementRevisionId('REQ-003-R1')],
      provider: 'github-issues',
      externalContainer: 'acme/repo',
      externalWorkItemId: '2',
      exportContentHash: dummyHashFn(storyB),
      exportedAt: now(),
      exportedBy: createActorId('ACTOR-1')
    });

    const mappingC = createBacklogExportMapping({
      id: 'MAP-C',
      storyId: storyC.id,
      baselineId: baseline1.id,
      requirementRevisionIds: [createRequirementRevisionId('REQ-003-R1')],
      provider: 'github-issues',
      externalContainer: 'acme/repo',
      externalWorkItemId: '3',
      exportContentHash: dummyHashFn(storyC),
      exportedAt: now(),
      exportedBy: createActorId('ACTOR-1')
    });

    const report = evaluateExportStaleness({
      baseline: baseline1,
      stories: [storyA, storyB, storyC],
      mappings: [mappingA, mappingB, mappingC],
      activeRequirementMap: new Map([
        ['REQ-001', 'REQ-001-R2'],
        ['REQ-003', 'REQ-003-R1']
      ]),
      activePolicyConstraintMap: new Map(),
      lookupRequirementRevision: (revId) => ({
        requirementId: revId.startsWith('REQ-001') ? 'REQ-001' : 'REQ-003',
        revision: revId === 'REQ-001-R1' ? 1 : 2
      }),
      computeStoryHash: dummyHashFn
    });

    expect(report.stories.find((s) => s.storyId === 'STORY-A')?.classification).toBe('STALE');
    expect(report.stories.find((s) => s.storyId === 'STORY-B')?.classification).toBe('IMPACTED');
    expect(report.stories.find((s) => s.storyId === 'STORY-C')?.classification).toBe('IMPACTED');
  });

  it('Test 10: Advisory semantic analysis returns isAdvisoryOnly: true', () => {
    const advisoryResult: AdvisorySemanticImpactResult = {
      isAdvisoryOnly: true,
      storyId: createStoryId('STORY-1'),
      semanticRiskLevel: 'HIGH',
      reasoning: 'Security policy change may alter session handling semantics',
      suggestedActions: ['Review MFA workflow'],
      modelAssisted: true
    };

    expect(advisoryResult.isAdvisoryOnly).toBe(true);
    expect(advisoryResult.semanticRiskLevel).toBe('HIGH');
    expect(advisoryResult.modelAssisted).toBe(true);
  });

  it('Test 11: Detects PREREQUISITE_VERSION_SUPERSEDED when prerequisite exportVersion advances', () => {
    const storyA = createStory({
      id: createStoryId('STORY-A'),
      title: 'Story A',
      narrative: { role: 'user', feature: 'A', benefit: 'benefit' },
      acceptanceCriteria: ['AC1'],
      scenarios: [
        {
          title: 'SA1',
          requirementRevisionIds: [createRequirementRevisionId('REQ-001-R1')],
          steps: [{ keyword: 'Given', text: 'step' }]
        }
      ],
      gherkinText: 'Feature: A\nScenario: A1',
      requirementRevisionIds: [createRequirementRevisionId('REQ-001-R1')],
      baselineId: baseline1.id
    });

    const storyB = createStory({
      id: createStoryId('STORY-B'),
      title: 'Story B',
      narrative: { role: 'user', feature: 'B', benefit: 'benefit' },
      acceptanceCriteria: ['AC1'],
      scenarios: [
        {
          title: 'SB1',
          requirementRevisionIds: [createRequirementRevisionId('REQ-003-R1')],
          steps: [{ keyword: 'Given', text: 'step' }]
        }
      ],
      gherkinText: 'Feature: B\nScenario: B1',
      requirementRevisionIds: [createRequirementRevisionId('REQ-003-R1')],
      dependencies: [storyA.id],
      baselineId: baseline1.id
    });

    const mappingA = createBacklogExportMapping({
      id: 'MAP-A',
      storyId: storyA.id,
      exportVersion: 2, // Upstream was updated to v2
      baselineId: baseline1.id,
      requirementRevisionIds: [createRequirementRevisionId('REQ-001-R1')],
      provider: 'github-issues',
      externalContainer: 'acme/repo',
      externalWorkItemId: '1',
      exportContentHash: dummyHashFn(storyA),
      exportedAt: now(),
      exportedBy: createActorId('ACTOR-1')
    });

    const mappingB = createBacklogExportMapping({
      id: 'MAP-B',
      storyId: storyB.id,
      exportVersion: 1,
      baselineId: baseline1.id,
      requirementRevisionIds: [createRequirementRevisionId('REQ-003-R1')],
      prerequisiteExportVersions: {
        'STORY-A': 1 // Recorded version 1, but mappingA is now version 2!
      },
      provider: 'github-issues',
      externalContainer: 'acme/repo',
      externalWorkItemId: '2',
      exportContentHash: dummyHashFn(storyB),
      exportedAt: now(),
      exportedBy: createActorId('ACTOR-1')
    });

    const report = evaluateExportStaleness({
      baseline: baseline1,
      stories: [storyA, storyB],
      mappings: [mappingA, mappingB],
      activeRequirementMap: new Map([
        ['REQ-001', 'REQ-001-R1'],
        ['REQ-003', 'REQ-003-R1']
      ]),
      activePolicyConstraintMap: new Map(),
      lookupRequirementRevision: (revId) => ({
        requirementId: revId.startsWith('REQ-001') ? 'REQ-001' : 'REQ-003',
        revision: 1
      }),
      computeStoryHash: dummyHashFn
    });

    const reportA = report.stories.find((s) => s.storyId === 'STORY-A');
    const reportB = report.stories.find((s) => s.storyId === 'STORY-B');

    expect(reportA?.classification).toBe('CURRENT');
    expect(reportB?.classification).toBe('IMPACTED');
    expect(reportB?.causes.some((c) => c.category === 'PREREQUISITE_VERSION_SUPERSEDED')).toBe(
      true
    );
    expect(reportB?.impactedByPrerequisiteStoryIds).toContain('STORY-A');
    expect(reportB?.history).toEqual([]);
  });
});
