import type {
  IGherkinValidatorGateway,
  GherkinValidationResult,
  GherkinValidationErrorDetails,
  ParsedGherkinDocument,
  ParsedGherkinScenario
} from '../../application/ports/validation/IGherkinValidatorGateway.js';

const STEP_KEYWORDS = ['Given', 'When', 'Then', 'And', 'But'] as const;

export class GherkinValidatorAdapter implements IGherkinValidatorGateway {
  async validate(gherkinText: string): Promise<GherkinValidationResult> {
    const raw = this.stripMarkdownFences(gherkinText).trim();
    if (!raw) {
      return {
        isValid: false,
        errorMessage: 'Gherkin document cannot be empty.',
        errorDetails: [{ message: 'Gherkin document cannot be empty.' }]
      };
    }

    const lines = raw.split(/\r?\n/);
    const errors: GherkinValidationErrorDetails[] = [];

    let featureTitle: string | undefined;
    const headerComments: string[] = [];
    const featureTags: string[] = [];
    const narrativeLines: string[] = [];

    let declaredBaselineId: string | undefined;
    const declaredStoryReqIds = new Set<string>();
    const declaredStoryPolIds = new Set<string>();

    const scenarios: ParsedGherkinScenario[] = [];

    let currentScenarioTitle: string | undefined;
    let currentScenarioLine: number | undefined;
    let currentScenarioTags: string[] = [];
    let currentScenarioSteps: { keyword: string; text: string; line: number }[] = [];
    let currentScenarioReqIds = new Set<string>();
    let currentScenarioPolIds = new Set<string>();
    let pendingScenarioTags: string[] = [];
    let pendingScenarioComments: string[] = [];

    let insideFeature = false;
    let insideScenario = false;

    const finalizeCurrentScenario = () => {
      if (currentScenarioTitle !== undefined) {
        if (currentScenarioSteps.length === 0) {
          errors.push({
            message: `Scenario '${currentScenarioTitle}' must have at least one step.`,
            line: currentScenarioLine
          });
        }
        scenarios.push({
          title: currentScenarioTitle,
          tags: Object.freeze([...currentScenarioTags]),
          steps: Object.freeze(
            currentScenarioSteps.map((s) => ({ keyword: s.keyword, text: s.text, line: s.line }))
          ),
          declaredRequirementRevisionIds: Object.freeze([...currentScenarioReqIds]),
          declaredPolicyConstraintRevisionIds:
            currentScenarioPolIds.size > 0 ? Object.freeze([...currentScenarioPolIds]) : undefined,
          line: currentScenarioLine
        });
      }
      currentScenarioTitle = undefined;
      currentScenarioLine = undefined;
      currentScenarioTags = [];
      currentScenarioSteps = [];
      currentScenarioReqIds = new Set<string>();
      currentScenarioPolIds = new Set<string>();
      insideScenario = false;
    };

    const parseProvenanceFromText = (
      text: string,
      targetReqs: Set<string>,
      targetPols: Set<string>
    ) => {
      // baseline
      const baseMatch = text.match(/(?:#\s*@baseline|@baseline)(?::)?\s*([A-Za-z0-9_-]+)/i);
      if (baseMatch && !declaredBaselineId) {
        declaredBaselineId = baseMatch[1].trim();
      }

      // requirements
      const reqMatches = text.matchAll(
        /(?:#\s*(?:@requirements|@req|@implements)|(?:@requirements|@req|@implements))(?::)?\s*([^\r\n@#]+)/gi
      );
      for (const m of reqMatches) {
        const cleaned = m[1].replace(/^[:\s]+/, '').trim();
        const ids = cleaned
          .split(/[\s,]+/)
          .map((s) => s.trim().replace(/^[:]+/, ''))
          .filter((s) => s.length > 0 && !s.startsWith('@') && !s.startsWith('#') && s !== ':');
        for (const id of ids) {
          targetReqs.add(id);
        }
      }

      // policy constraints
      const polMatches = text.matchAll(
        /(?:#\s*@policy-constraints|@policy-constraints)(?::)?\s*([^\r\n@#]+)/gi
      );
      for (const m of polMatches) {
        const cleaned = m[1].replace(/^[:\s]+/, '').trim();
        const ids = cleaned
          .split(/[\s,]+/)
          .map((s) => s.trim().replace(/^[:]+/, ''))
          .filter((s) => s.length > 0 && !s.startsWith('@') && !s.startsWith('#') && s !== ':');
        for (const id of ids) {
          targetPols.add(id);
        }
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const originalLine = lines[i];
      const line = originalLine.trim();

      if (!line) {
        continue;
      }

      // If we are inside a scenario with steps already parsed, and we encounter a tag or authority comment,
      // that marks the beginning of the next scenario!
      if (insideScenario && currentScenarioSteps.length > 0) {
        if (
          line.startsWith('@') ||
          /^#\s*@(requirements|req|implements|policy-constraints|baseline)/i.test(line)
        ) {
          finalizeCurrentScenario();
        }
      }

      // Comments
      if (line.startsWith('#')) {
        if (!insideFeature) {
          headerComments.push(line);
          parseProvenanceFromText(line, declaredStoryReqIds, declaredStoryPolIds);
        } else if (!insideScenario) {
          headerComments.push(line);
          parseProvenanceFromText(line, declaredStoryReqIds, declaredStoryPolIds);
          pendingScenarioComments.push(line);
        } else {
          // Inside scenario
          parseProvenanceFromText(line, currentScenarioReqIds, currentScenarioPolIds);
          pendingScenarioComments.push(line);
        }
        continue;
      }

      // Tags
      if (line.startsWith('@')) {
        const tagsOnLine = line.split(/\s+/).filter((t) => t.startsWith('@'));
        if (!insideFeature) {
          featureTags.push(...tagsOnLine);
          parseProvenanceFromText(line, declaredStoryReqIds, declaredStoryPolIds);
        } else if (!insideScenario) {
          pendingScenarioTags.push(...tagsOnLine);
          parseProvenanceFromText(line, declaredStoryReqIds, declaredStoryPolIds);
        } else {
          // Tag inside scenario before any steps
          currentScenarioTags.push(...tagsOnLine);
          for (const t of tagsOnLine) {
            parseProvenanceFromText(t, currentScenarioReqIds, currentScenarioPolIds);
          }
        }
        continue;
      }

      // Feature declaration
      const featureMatch = line.match(/^Feature:\s*(.+)$/i);
      if (featureMatch) {
        if (featureTitle !== undefined) {
          errors.push({
            message: 'Multiple Feature declarations found in single Gherkin document.',
            line: lineNum
          });
        }
        featureTitle = featureMatch[1].trim();
        insideFeature = true;
        continue;
      }

      // If we haven't seen Feature: yet and this is not a tag/comment
      if (!insideFeature) {
        errors.push({
          message: `Expected 'Feature:' declaration, but found: '${line}'`,
          line: lineNum
        });
        continue;
      }

      // Scenario or Scenario Outline declaration
      const scenarioMatch = line.match(/^Scenario(?: Outline)?:\s*(.+)$/i);
      if (scenarioMatch) {
        finalizeCurrentScenario();
        insideScenario = true;
        currentScenarioTitle = scenarioMatch[1].trim();
        currentScenarioLine = lineNum;
        currentScenarioTags = [...pendingScenarioTags];
        pendingScenarioTags = [];

        // Parse scenario tags and pending comments for scenario-level authority
        for (const tag of currentScenarioTags) {
          parseProvenanceFromText(tag, currentScenarioReqIds, currentScenarioPolIds);
        }
        for (const comm of pendingScenarioComments) {
          parseProvenanceFromText(comm, currentScenarioReqIds, currentScenarioPolIds);
        }
        pendingScenarioComments = [];
        continue;
      }

      // Step keywords
      const stepMatch = line.match(/^(Given|When|Then|And|But)\s+(.+)$/i);
      if (stepMatch) {
        if (!insideScenario) {
          errors.push({
            message: `Step '${line}' declared outside of any Scenario.`,
            line: lineNum
          });
          continue;
        }

        const rawKw = stepMatch[1];
        const normalizedKw =
          STEP_KEYWORDS.find((k) => k.toLowerCase() === rawKw.toLowerCase()) ?? 'Given';
        currentScenarioSteps.push({
          keyword: normalizedKw,
          text: stepMatch[2].trim(),
          line: lineNum
        });
        continue;
      }

      // Narrative text between Feature and first Scenario
      if (insideFeature && !insideScenario) {
        narrativeLines.push(line);
        continue;
      }

      // If inside scenario and not a step, could be docstring or table or unrecognized
      if (insideScenario) {
        if (line.startsWith('|') || line.startsWith('"""') || line.startsWith("'''")) {
          // Gherkin table or docstring - attach as part of last step or ignore
          if (currentScenarioSteps.length > 0) {
            const lastStep = currentScenarioSteps[currentScenarioSteps.length - 1];
            currentScenarioSteps[currentScenarioSteps.length - 1] = {
              ...lastStep,
              text: `${lastStep.text}\n${line}`
            };
          }
          continue;
        }

        // Unrecognized line inside scenario
        errors.push({
          message: `Unrecognized statement in Scenario '${currentScenarioTitle}': '${line}'`,
          line: lineNum
        });
      }
    }

    finalizeCurrentScenario();

    if (!featureTitle) {
      errors.push({
        message: "Missing 'Feature:' declaration in Gherkin document."
      });
    }

    if (scenarios.length === 0) {
      errors.push({
        message: 'Gherkin document must declare at least one Scenario.'
      });
    }

    if (errors.length > 0) {
      return {
        isValid: false,
        errorMessage: errors
          .map((e) => (e.line ? `Line ${e.line}: ${e.message}` : e.message))
          .join('; '),
        errorDetails: Object.freeze(errors)
      };
    }

    // Parse narrative details
    let narrative: { role: string; feature: string; benefit: string; rawText: string } | undefined;
    const fullNarrativeText = narrativeLines.join('\n').trim();

    const asAMatch = fullNarrativeText.match(/As an?\s+([^\r\n]+)/i);
    const iWantMatch = fullNarrativeText.match(/I want(?: to)?\s+([^\r\n]+)/i);
    const soThatMatch = fullNarrativeText.match(/(?:So that|In order to)\s+([^\r\n]+)/i);

    if (asAMatch && iWantMatch && soThatMatch) {
      narrative = {
        role: asAMatch[1].trim(),
        feature: iWantMatch[1].trim(),
        benefit: soThatMatch[1].trim(),
        rawText: fullNarrativeText
      };
    } else {
      // Fallback narrative extracted from feature title and text
      narrative = {
        role: asAMatch ? asAMatch[1].trim() : 'User',
        feature: iWantMatch ? iWantMatch[1].trim() : featureTitle!,
        benefit: soThatMatch ? soThatMatch[1].trim() : `Deliver value for ${featureTitle!}`,
        rawText: fullNarrativeText || `Feature: ${featureTitle}`
      };
    }

    // Ensure story requirement revision IDs include scenario-level IDs if not already there
    for (const sc of scenarios) {
      for (const reqId of sc.declaredRequirementRevisionIds) {
        declaredStoryReqIds.add(reqId);
      }
      for (const polId of sc.declaredPolicyConstraintRevisionIds ?? []) {
        declaredStoryPolIds.add(polId);
      }
    }

    const parsedDocument: ParsedGherkinDocument = {
      title: featureTitle!,
      narrative: Object.freeze(narrative),
      tags: Object.freeze(featureTags),
      headerComments: Object.freeze(headerComments),
      declaredBaselineId,
      declaredRequirementRevisionIds: Object.freeze([...declaredStoryReqIds]),
      declaredPolicyConstraintRevisionIds:
        declaredStoryPolIds.size > 0 ? Object.freeze([...declaredStoryPolIds]) : undefined,
      scenarios: Object.freeze(scenarios)
    };

    return {
      isValid: true,
      parsedDocument: Object.freeze(parsedDocument)
    };
  }

  private stripMarkdownFences(content: string): string {
    let result = content.trim();
    if (result.startsWith('```')) {
      const firstNewline = result.indexOf('\n');
      if (firstNewline !== -1) {
        result = result.substring(firstNewline + 1);
      }
    }
    if (result.endsWith('```')) {
      const lastFence = result.lastIndexOf('```');
      result = result.substring(0, lastFence);
    }
    return result.trim();
  }
}
