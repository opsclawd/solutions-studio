import { describe, it, expect } from 'vitest';
import {
  createStoryId,
  createRequirementsBaselineId,
  createRequirementRevisionId,
  createPolicyConstraintRevisionId,
  createStory,
  StoryInvariantViolationError
} from '../../src/index.js';

describe('Story', () => {
  const baselineId = createRequirementsBaselineId('BASE-001');
  const req1 = createRequirementRevisionId('REQ-001-R1');
  const req2 = createRequirementRevisionId('REQ-002-R1');
  const pol1 = createPolicyConstraintRevisionId('POL-SEC-001-R1');

  it('creates a valid Story with exact requirement-level traceability and deep freezing', () => {
    const story = createStory({
      id: createStoryId('STORY-001'),
      baselineId,
      title: 'User Authentication Story',
      narrative: {
        role: 'Registered User',
        feature: 'Multi-factor login',
        benefit: 'Secure access to private financial data'
      },
      requirementRevisionIds: [req1, req2],
      policyConstraintRevisionIds: [pol1],
      scenarios: [
        {
          id: 'SCENARIO-1',
          title: 'Successful login with MFA code',
          requirementRevisionIds: [req1],
          policyConstraintRevisionIds: [pol1],
          steps: [
            { keyword: 'Given', text: 'a user with valid credentials' },
            { keyword: 'When', text: 'they submit their password and valid MFA code' },
            { keyword: 'Then', text: 'they are granted access to the dashboard' }
          ]
        },
        {
          title: 'Fallback password recovery',
          requirementRevisionIds: [req2],
          steps: [
            { keyword: 'Given', text: 'a locked out user' },
            { keyword: 'When', text: 'they request a password reset email' },
            { keyword: 'Then', text: 'a secure one-time link is sent' }
          ]
        }
      ],
      gherkinText:
        'Feature: User Authentication\n  Scenario: Successful login with MFA code\n  Scenario: Fallback password recovery'
    });

    expect(story.id).toBe('STORY-001');
    expect(story.baselineId).toBe('BASE-001');
    expect(story.title).toBe('User Authentication Story');
    expect(story.narrative.role).toBe('Registered User');
    expect(story.narrative.feature).toBe('Multi-factor login');
    expect(story.narrative.benefit).toBe('Secure access to private financial data');
    expect(story.requirementRevisionIds).toEqual(['REQ-001-R1', 'REQ-002-R1']);
    expect(story.policyConstraintRevisionIds).toEqual(['POL-SEC-001-R1']);
    expect(story.scenarios).toHaveLength(2);
    expect(story.scenarios[0].title).toBe('Successful login with MFA code');
    expect(story.scenarios[0].requirementRevisionIds).toEqual(['REQ-001-R1']);
    expect(story.scenarios[0].policyConstraintRevisionIds).toEqual(['POL-SEC-001-R1']);
    expect(story.scenarios[0].steps).toHaveLength(3);
    expect(story.acceptanceCriteria).toEqual([
      'Successful login with MFA code',
      'Fallback password recovery'
    ]);

    expect(Object.isFrozen(story)).toBe(true);
    expect(Object.isFrozen(story.narrative)).toBe(true);
    expect(Object.isFrozen(story.requirementRevisionIds)).toBe(true);
    expect(Object.isFrozen(story.policyConstraintRevisionIds)).toBe(true);
    expect(Object.isFrozen(story.scenarios)).toBe(true);
    expect(Object.isFrozen(story.scenarios[0])).toBe(true);
    expect(Object.isFrozen(story.scenarios[0].steps)).toBe(true);
    expect(Object.isFrozen(story.scenarios[0].steps[0])).toBe(true);
  });

  it('rejects empty id or baselineId or title', () => {
    expect(() =>
      createStory({
        id: '',
        baselineId,
        title: 'Title',
        narrative: { role: 'User', feature: 'F', benefit: 'B' },
        requirementRevisionIds: [req1],
        scenarios: [
          {
            title: 'S1',
            requirementRevisionIds: [req1],
            steps: [{ keyword: 'Given', text: 'step' }]
          }
        ],
        gherkinText: 'Feature: F'
      })
    ).toThrow(StoryInvariantViolationError);

    expect(() =>
      createStory({
        id: 'STORY-1',
        baselineId: '   ',
        title: 'Title',
        narrative: { role: 'User', feature: 'F', benefit: 'B' },
        requirementRevisionIds: [req1],
        scenarios: [
          {
            title: 'S1',
            requirementRevisionIds: [req1],
            steps: [{ keyword: 'Given', text: 'step' }]
          }
        ],
        gherkinText: 'Feature: F'
      })
    ).toThrow(StoryInvariantViolationError);

    expect(() =>
      createStory({
        id: 'STORY-1',
        baselineId,
        title: '',
        narrative: { role: 'User', feature: 'F', benefit: 'B' },
        requirementRevisionIds: [req1],
        scenarios: [
          {
            title: 'S1',
            requirementRevisionIds: [req1],
            steps: [{ keyword: 'Given', text: 'step' }]
          }
        ],
        gherkinText: 'Feature: F'
      })
    ).toThrow(StoryInvariantViolationError);
  });

  it('rejects incomplete narrative elements', () => {
    expect(() =>
      createStory({
        id: 'STORY-1',
        baselineId,
        title: 'Title',
        narrative: { role: '', feature: 'F', benefit: 'B' },
        requirementRevisionIds: [req1],
        scenarios: [
          {
            title: 'S1',
            requirementRevisionIds: [req1],
            steps: [{ keyword: 'Given', text: 'step' }]
          }
        ],
        gherkinText: 'Feature: F'
      })
    ).toThrow(StoryInvariantViolationError);
  });

  it('rejects empty requirementRevisionIds in story', () => {
    expect(() =>
      createStory({
        id: 'STORY-1',
        baselineId,
        title: 'Title',
        narrative: { role: 'User', feature: 'F', benefit: 'B' },
        requirementRevisionIds: [],
        scenarios: [
          {
            title: 'S1',
            requirementRevisionIds: [req1],
            steps: [{ keyword: 'Given', text: 'step' }]
          }
        ],
        gherkinText: 'Feature: F'
      })
    ).toThrow('Story requirementRevisionIds must contain at least one requirement revision');
  });

  it('rejects empty scenarios array', () => {
    expect(() =>
      createStory({
        id: 'STORY-1',
        baselineId,
        title: 'Title',
        narrative: { role: 'User', feature: 'F', benefit: 'B' },
        requirementRevisionIds: [req1],
        scenarios: [],
        gherkinText: 'Feature: F'
      })
    ).toThrow('Story scenarios must contain at least one Gherkin scenario');
  });

  it('rejects scenario without steps', () => {
    expect(() =>
      createStory({
        id: 'STORY-1',
        baselineId,
        title: 'Title',
        narrative: { role: 'User', feature: 'F', benefit: 'B' },
        requirementRevisionIds: [req1],
        scenarios: [
          {
            title: 'Scenario with no steps',
            requirementRevisionIds: [req1],
            steps: []
          }
        ],
        gherkinText: 'Feature: F'
      })
    ).toThrow("Scenario 'Scenario with no steps' must have at least one step");
  });

  it('rejects scenario with invalid step keyword', () => {
    expect(() =>
      createStory({
        id: 'STORY-1',
        baselineId,
        title: 'Title',
        narrative: { role: 'User', feature: 'F', benefit: 'B' },
        requirementRevisionIds: [req1],
        scenarios: [
          {
            title: 'Scenario',
            requirementRevisionIds: [req1],
            steps: [{ keyword: 'InvalidKeyword' as any, text: 'step text' }]
          }
        ],
        gherkinText: 'Feature: F'
      })
    ).toThrow("has invalid keyword 'InvalidKeyword'");
  });

  it('rejects scenario without requirement revision authority reference', () => {
    expect(() =>
      createStory({
        id: 'STORY-1',
        baselineId,
        title: 'Title',
        narrative: { role: 'User', feature: 'F', benefit: 'B' },
        requirementRevisionIds: [req1],
        scenarios: [
          {
            title: 'Scenario with no authority ref',
            requirementRevisionIds: [],
            steps: [{ keyword: 'Given', text: 'step' }]
          }
        ],
        gherkinText: 'Feature: F'
      })
    ).toThrow(
      "Scenario 'Scenario with no authority ref' must declare at least one requirement revision reference"
    );
  });

  it('rejects scenario referencing requirement revision not present in story header', () => {
    expect(() =>
      createStory({
        id: 'STORY-1',
        baselineId,
        title: 'Title',
        narrative: { role: 'User', feature: 'F', benefit: 'B' },
        requirementRevisionIds: [req1],
        scenarios: [
          {
            title: 'Scenario with out-of-scope ref',
            requirementRevisionIds: [createRequirementRevisionId('REQ-UNKNOWN-R1')],
            steps: [{ keyword: 'Given', text: 'step' }]
          }
        ],
        gherkinText: 'Feature: F'
      })
    ).toThrow(
      "Scenario 'Scenario with out-of-scope ref' references requirement revision 'REQ-UNKNOWN-R1' which is not in story requirement revisions"
    );
  });

  it('rejects scenario referencing policy constraint revision not present in story header', () => {
    expect(() =>
      createStory({
        id: 'STORY-1',
        baselineId,
        title: 'Title',
        narrative: { role: 'User', feature: 'F', benefit: 'B' },
        requirementRevisionIds: [req1],
        policyConstraintRevisionIds: [pol1],
        scenarios: [
          {
            title: 'Scenario with out-of-scope pol ref',
            requirementRevisionIds: [req1],
            policyConstraintRevisionIds: [createPolicyConstraintRevisionId('POL-UNKNOWN-R1')],
            steps: [{ keyword: 'Given', text: 'step' }]
          }
        ],
        gherkinText: 'Feature: F'
      })
    ).toThrow(
      "Scenario 'Scenario with out-of-scope pol ref' references policy constraint revision 'POL-UNKNOWN-R1' which is not in story policy constraints"
    );
  });
});
