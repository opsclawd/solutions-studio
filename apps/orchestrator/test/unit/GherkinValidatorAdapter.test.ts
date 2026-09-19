import { describe, it, expect } from 'vitest';
import { GherkinValidatorAdapter } from '../../src/infrastructure/validation/GherkinValidatorAdapter.js';

describe('GherkinValidatorAdapter', () => {
  const adapter = new GherkinValidatorAdapter();

  it('parses valid Gherkin feature with narrative, scenarios, and tags', async () => {
    const gherkin = `
# @baseline BASE-001
# @requirements REQ-001-R1, REQ-002-R1
# @policy-constraints POL-SEC-001-R1

Feature: User Account Provisioning
  As a new customer
  I want to create an account
  So that I can purchase subscriptions

  @requirements:REQ-001-R1 @policy-constraints:POL-SEC-001-R1
  Scenario: Customer successfully signs up
    Given an unregistered user with email "customer@example.com"
    When they submit their registration details
    Then an account should be created
    And a welcome email should be sent

  # @requirements: REQ-002-R1
  Scenario: Duplicate email rejected
    Given a registered user with email "customer@example.com"
    When another user tries to register with "customer@example.com"
    Then the registration should fail with "Email already in use"
`;

    const result = await adapter.validate(gherkin);
    expect(result.isValid).toBe(true);
    expect(result.parsedDocument).toBeDefined();
    const doc = result.parsedDocument!;
    expect(doc.title).toBe('User Account Provisioning');
    expect(doc.declaredBaselineId).toBe('BASE-001');
    expect(doc.declaredRequirementRevisionIds).toEqual(
      expect.arrayContaining(['REQ-001-R1', 'REQ-002-R1'])
    );
    expect(doc.declaredPolicyConstraintRevisionIds).toEqual(['POL-SEC-001-R1']);
    expect(doc.narrative?.role).toBe('new customer');
    expect(doc.narrative?.feature).toBe('create an account');
    expect(doc.narrative?.benefit).toBe('I can purchase subscriptions');

    expect(doc.scenarios).toHaveLength(2);
    expect(doc.scenarios[0].title).toBe('Customer successfully signs up');
    expect(doc.scenarios[0].declaredRequirementRevisionIds).toEqual(['REQ-001-R1']);
    expect(doc.scenarios[0].declaredPolicyConstraintRevisionIds).toEqual(['POL-SEC-001-R1']);
    expect(doc.scenarios[0].steps).toHaveLength(4);
    expect(doc.scenarios[0].steps[0].keyword).toBe('Given');
    expect(doc.scenarios[0].steps[3].keyword).toBe('And');

    expect(doc.scenarios[1].title).toBe('Duplicate email rejected');
    expect(doc.scenarios[1].declaredRequirementRevisionIds).toEqual(['REQ-002-R1']);
  });

  it('handles markdown code fences (```gherkin ... ```)', async () => {
    const gherkin = `\`\`\`gherkin
# @baseline BASE-001
# @requirements REQ-001-R1

Feature: Minimal Feature
  Scenario: Minimal Scenario
    @req:REQ-001-R1
    Given a step
\`\`\``;
    const result = await adapter.validate(gherkin);
    expect(result.isValid).toBe(true);
    expect(result.parsedDocument?.title).toBe('Minimal Feature');
  });

  it('rejects empty document', async () => {
    const result = await adapter.validate('   ');
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain('cannot be empty');
  });

  it('rejects document missing Feature declaration', async () => {
    const gherkin = `
Scenario: Scenario without feature
  Given a step
`;
    const result = await adapter.validate(gherkin);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain("Missing 'Feature:' declaration");
  });

  it('rejects steps outside of any scenario', async () => {
    const gherkin = `
Feature: Feature with orphaned step
  Given step before scenario

  Scenario: Scenario 1
    Given step inside scenario
`;
    const result = await adapter.validate(gherkin);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain('declared outside of any Scenario');
  });

  it('rejects scenario without steps', async () => {
    const gherkin = `
Feature: Feature with empty scenario
  Scenario: Empty scenario

  Scenario: Scenario with steps
    Given step
`;
    const result = await adapter.validate(gherkin);
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain("Scenario 'Empty scenario' must have at least one step");
  });
});
