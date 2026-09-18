import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  FIXTURE_CATEGORIES,
  EvidenceExpectationDtoSchema,
  EvidenceReferenceDtoSchema,
  EvaluationFixtureDtoSchema,
  EvaluationManifestDtoSchema
} from '@solutions-studio/contracts';
import { loadManifest } from '../evaluation/support/loadManifest.js';

describe('Adversarial Requirements Evaluation Corpus Integrity', () => {
  const corpus = loadManifest();

  it('1. Manifest and every fixture parse against their Zod schemas without error', () => {
    expect(corpus.manifest).toBeDefined();
    expect(() => EvaluationManifestDtoSchema.parse(corpus.manifest)).not.toThrow();
    expect(corpus.manifest.corpusVersion).toBe('v2.0');
    expect(corpus.fixtures.size).toBe(16);

    for (const [fixtureId, loaded] of corpus.fixtures) {
      expect(() => EvaluationFixtureDtoSchema.parse(loaded.fixture)).not.toThrow();
      expect(loaded.fixture.fixtureId).toBe(fixtureId);
    }
  });

  it('1b. Historical corpus.v1.json manifest loads cleanly and validates against 10-category v1 snapshot', () => {
    const v1Corpus = loadManifest('corpus.v1.json');
    expect(v1Corpus.manifest).toBeDefined();
    expect(() => EvaluationManifestDtoSchema.parse(v1Corpus.manifest)).not.toThrow();
    expect(v1Corpus.manifest.corpusVersion).toBe('v1.0');
    expect(v1Corpus.fixtures.size).toBe(14);
    for (const [fixtureId, loaded] of v1Corpus.fixtures) {
      expect(() => EvaluationFixtureDtoSchema.parse(loaded.fixture)).not.toThrow();
      expect(loaded.fixture.fixtureId).toBe(fixtureId);
    }
  });

  it('2. Every FIXTURE_CATEGORIES value is covered by at least one fixture', () => {
    const coveredCategories = new Set<string>();
    for (const [, loaded] of corpus.fixtures) {
      for (const cat of loaded.fixture.categories) {
        coveredCategories.add(cat);
      }
    }

    for (const category of FIXTURE_CATEGORIES) {
      expect(
        coveredCategories.has(category),
        `Missing coverage for fixture category '${category}'`
      ).toBe(true);
    }
  });

  it('3. Important categories have more than one example fixture', () => {
    const categoryCounts = new Map<string, number>();
    for (const [, loaded] of corpus.fixtures) {
      for (const cat of loaded.fixture.categories) {
        categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
      }
    }

    const multiExampleCategories = [
      'contradictory-approval-thresholds',
      'missing-actors-authorization',
      'false-positive-near-conflict'
    ];

    for (const cat of multiExampleCategories) {
      const count = categoryCounts.get(cat) ?? 0;
      expect(
        count,
        `Expected category '${cat}' to have >= 2 fixture examples, got ${count}`
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it('4. Exactly one fixture has canonicalMessyPackage: true and covers all 12 categories', () => {
    const canonicalFixtures = Array.from(corpus.fixtures.values()).filter(
      (f) => f.fixture.canonicalMessyPackage
    );

    expect(canonicalFixtures.length).toBe(1);
    const messy = canonicalFixtures[0];
    expect(messy.fixture.fixtureId).toBe('canonical-messy-discovery-package');

    const messyCategories = new Set(messy.fixture.categories);
    for (const cat of FIXTURE_CATEGORIES) {
      expect(
        messyCategories.has(cat),
        `Canonical messy package missing required category '${cat}'`
      ).toBe(true);
    }

    // Check that multiple findings share domain type 'contradiction' with distinct category values
    const contradictionFindings = messy.fixture.expectedFindings.filter(
      (f) => f.type === 'contradiction'
    );
    expect(contradictionFindings.length).toBeGreaterThanOrEqual(3);
    const contradictionCategories = new Set(contradictionFindings.map((f) => f.category));
    expect(contradictionCategories.has('contradictory-approval-thresholds')).toBe(true);
    expect(contradictionCategories.has('source-authority-conflict')).toBe(true);
    expect(contradictionCategories.has('superseded-source-or-requirement')).toBe(true);
  });

  it('5. Every evidence sourceRevisionId resolves to a declared source in the same fixture', () => {
    for (const [fixtureId, loaded] of corpus.fixtures) {
      const declaredRevisionIds = new Set(loaded.fixture.sources.map((s) => s.sourceRevisionId));

      for (const req of loaded.fixture.expectedRequirements) {
        for (const ev of req.evidence) {
          expect(
            declaredRevisionIds.has(ev.sourceRevisionId),
            `Fixture '${fixtureId}' requirement '${req.requirementKey}' references undeclared sourceRevisionId '${ev.sourceRevisionId}'`
          ).toBe(true);
        }
      }

      for (const finding of loaded.fixture.expectedFindings) {
        for (const ev of finding.evidence) {
          expect(
            declaredRevisionIds.has(ev.sourceRevisionId),
            `Fixture '${fixtureId}' finding '${finding.findingKey}' references undeclared sourceRevisionId '${ev.sourceRevisionId}'`
          ).toBe(true);
        }
      }

      for (const nonFinding of loaded.fixture.expectedNonFindings) {
        for (const ev of nonFinding.evidence) {
          expect(
            declaredRevisionIds.has(ev.sourceRevisionId),
            `Fixture '${fixtureId}' non-finding '${nonFinding.description}' references undeclared sourceRevisionId '${ev.sourceRevisionId}'`
          ).toBe(true);
        }
      }
    }
  });

  it('6. Every expectedFindings relatedRequirementKeys entry resolves to a declared requirementKey', () => {
    for (const [fixtureId, loaded] of corpus.fixtures) {
      const declaredReqKeys = new Set(
        loaded.fixture.expectedRequirements.map((r) => r.requirementKey)
      );

      for (const finding of loaded.fixture.expectedFindings) {
        for (const relKey of finding.relatedRequirementKeys) {
          expect(
            declaredReqKeys.has(relKey),
            `Fixture '${fixtureId}' finding '${finding.findingKey}' references undeclared requirementKey '${relKey}'`
          ).toBe(true);
        }
      }
    }
  });

  it('7. IDs and keys are properly unique across corpus and fixtures', () => {
    const fixtureIds = new Set<string>();

    for (const [fixtureId, loaded] of corpus.fixtures) {
      expect(fixtureIds.has(fixtureId), `Duplicate fixtureId '${fixtureId}'`).toBe(false);
      fixtureIds.add(fixtureId);

      // Unique sourceRevisionId within fixture
      const sourceRevisionIds = new Set<string>();
      for (const source of loaded.fixture.sources) {
        expect(
          sourceRevisionIds.has(source.sourceRevisionId),
          `Fixture '${fixtureId}' duplicate sourceRevisionId '${source.sourceRevisionId}'`
        ).toBe(false);
        sourceRevisionIds.add(source.sourceRevisionId);
      }

      // Unique requirementKey within fixture
      const requirementKeys = new Set<string>();
      for (const req of loaded.fixture.expectedRequirements) {
        expect(
          requirementKeys.has(req.requirementKey),
          `Fixture '${fixtureId}' duplicate requirementKey '${req.requirementKey}'`
        ).toBe(false);
        requirementKeys.add(req.requirementKey);
      }

      // Unique findingKey within fixture
      const findingKeys = new Set<string>();
      for (const finding of loaded.fixture.expectedFindings) {
        expect(
          findingKeys.has(finding.findingKey),
          `Fixture '${fixtureId}' duplicate findingKey '${finding.findingKey}'`
        ).toBe(false);
        findingKeys.add(finding.findingKey);
      }
    }
  });

  it('8. Content hashes are non-empty and stable, and all source paths exist on disk', () => {
    const secondLoad = loadManifest();

    for (const [fixtureId, loaded] of corpus.fixtures) {
      const secondLoaded = secondLoad.fixtures.get(fixtureId)!;

      for (const [revId, rev] of loaded.sourceRevisions) {
        expect(rev.contentHash.length).toBe(64); // SHA-256 hex
        expect(rev.text.length).toBeGreaterThan(0);

        const secondRev = secondLoaded.sourceRevisions.get(revId)!;
        expect(rev.contentHash).toBe(secondRev.contentHash);
      }

      for (const source of loaded.fixture.sources) {
        const filePath = path.join(loaded.fixtureDir, source.path);
        expect(
          fs.existsSync(filePath),
          `Fixture '${fixtureId}' declared path '${source.path}' does not exist on disk`
        ).toBe(true);
      }
    }
  });

  it('9. Supersession chains per sourceId within fixtures are well-formed, linear, and acyclic', () => {
    for (const [fixtureId, loaded] of corpus.fixtures) {
      expect(() => validateSourceLineages(loaded.fixture.sources, fixtureId)).not.toThrow();
    }
  });

  it('10. Every category in a fixtures categories array is witnessed by an expected finding or non-finding', () => {
    for (const [fixtureId, loaded] of corpus.fixtures) {
      const witnessedCategories = new Set<string>();

      for (const finding of loaded.fixture.expectedFindings) {
        witnessedCategories.add(finding.category);
      }

      for (const nonFinding of loaded.fixture.expectedNonFindings) {
        witnessedCategories.add(nonFinding.category);
      }

      for (const declaredCat of loaded.fixture.categories) {
        expect(
          witnessedCategories.has(declaredCat),
          `Fixture '${fixtureId}' declares category '${declaredCat}' but has no expected finding or non-finding witnessing it (phantom category tag)`
        ).toBe(true);
      }
    }
  });

  it('11. Every expectedFinding and expectedNonFinding category is a member of the fixtures declared categories', () => {
    for (const [fixtureId, loaded] of corpus.fixtures) {
      const declaredCategories = new Set(loaded.fixture.categories);

      for (const finding of loaded.fixture.expectedFindings) {
        expect(
          declaredCategories.has(finding.category),
          `Fixture '${fixtureId}' finding '${finding.findingKey}' uses category '${finding.category}' which is not in the fixture's categories array`
        ).toBe(true);
      }

      for (const nonFinding of loaded.fixture.expectedNonFindings) {
        expect(
          declaredCategories.has(nonFinding.category),
          `Fixture '${fixtureId}' non-finding '${nonFinding.description}' uses category '${nonFinding.category}' which is not in the fixture's categories array`
        ).toBe(true);
      }
    }
  });

  it('12. EvidenceExpectationDtoSchema is reference-identical to EvidenceReferenceDtoSchema', () => {
    expect(EvidenceExpectationDtoSchema).toBe(EvidenceReferenceDtoSchema);
  });

  it('13. contradictory-approval-thresholds findings represent mutually exclusive permissions, not compatible nested rules', () => {
    const thresholdFixtures = Array.from(corpus.fixtures.values()).filter((f) =>
      f.fixture.categories.includes('contradictory-approval-thresholds')
    );

    // Verify there are multiple fixtures planting this category (>= 2 dedicated + canonical)
    expect(thresholdFixtures.length).toBeGreaterThanOrEqual(3);

    for (const loaded of thresholdFixtures) {
      const thresholdFindings = loaded.fixture.expectedFindings.filter(
        (f) => f.category === 'contradictory-approval-thresholds'
      );

      expect(
        thresholdFindings.length,
        `Fixture '${loaded.fixture.fixtureId}' declared 'contradictory-approval-thresholds' but has no finding for it`
      ).toBeGreaterThanOrEqual(1);

      for (const finding of thresholdFindings) {
        // Every threshold contradiction must reference related requirements
        expect(finding.relatedRequirementKeys.length).toBeGreaterThanOrEqual(2);

        // Find the referenced requirements
        const relatedReqs = loaded.fixture.expectedRequirements.filter((r) =>
          finding.relatedRequirementKeys.includes(r.requirementKey)
        );

        // At least one of the requirements must specify permission/exemption without the higher authority
        // (e.g. "without VP approval", "without CFO review", "without CEO sign-off", "up to $X may be authorized without")
        // while another requires that higher authority above a lower threshold.
        const hasWithoutApprovalLanguage = relatedReqs.some((req) =>
          /without|solely/i.test(req.statementPattern ?? '')
        );

        expect(
          hasWithoutApprovalLanguage,
          `Fixture '${loaded.fixture.fixtureId}' finding '${finding.findingKey}' does not specify mutually exclusive permission language (risk of compatible nested rules). Statement patterns: ${relatedReqs.map((r) => r.statementPattern).join(' vs ')}`
        ).toBe(true);

        // Rationale must explain the mutual exclusivity
        expect(
          finding.rationale,
          `Fixture '${loaded.fixture.fixtureId}' finding '${finding.findingKey}' rationale missing mutual exclusivity explanation`
        ).toMatch(/mutually exclusive|directly contradicting|contradicting/i);
      }
    }
  });
});

export interface LineageSourceItem {
  readonly sourceRevisionId: string;
  readonly sourceId: string;
  readonly revision: number;
  readonly supersedes?: string;
}

export function validateSourceLineages(
  sources: readonly LineageSourceItem[],
  fixtureId = 'fixture'
): void {
  const byRevId = new Map(sources.map((s) => [s.sourceRevisionId, s]));

  // 1. Group by sourceId to enforce lineage integrity:
  // - Unique revision ordinals per lineage
  // - Exactly one root per lineage (no disconnected roots, no cycles with 0 roots)
  const sourcesBySourceId = new Map<string, LineageSourceItem[]>();
  for (const source of sources) {
    const list = sourcesBySourceId.get(source.sourceId) ?? [];
    list.push(source);
    sourcesBySourceId.set(source.sourceId, list);
  }

  for (const [sourceId, lineageSources] of sourcesBySourceId) {
    const revisions = lineageSources.map((s) => s.revision);
    const uniqueRevisions = new Set(revisions);
    if (uniqueRevisions.size !== revisions.length) {
      throw new Error(
        `Fixture '${fixtureId}' source lineage '${sourceId}' contains duplicate revision ordinals: [${revisions.join(', ')}]`
      );
    }

    const roots = lineageSources.filter((s) => !s.supersedes);
    if (roots.length !== 1) {
      throw new Error(
        `Fixture '${fixtureId}' source lineage '${sourceId}' must have exactly one root revision without supersedes, found ${roots.length}`
      );
    }
  }

  // 2. Predecessor declarations: resolution, sourceId consistency, strictly increasing revision
  for (const source of sources) {
    if (source.supersedes) {
      const predecessor = byRevId.get(source.supersedes);
      if (!predecessor) {
        throw new Error(
          `Fixture '${fixtureId}' source '${source.sourceRevisionId}' supersedes undeclared revision '${source.supersedes}'`
        );
      }
      if (predecessor.sourceId !== source.sourceId) {
        throw new Error(
          `Fixture '${fixtureId}' source '${source.sourceRevisionId}' supersedes '${source.supersedes}' with different sourceId ('${source.sourceId}' vs '${predecessor.sourceId}')`
        );
      }
      if (predecessor.revision >= source.revision) {
        throw new Error(
          `Fixture '${fixtureId}' source '${source.sourceRevisionId}' (rev ${source.revision}) does not have strictly greater revision than predecessor '${source.supersedes}' (rev ${predecessor.revision})`
        );
      }
    }
  }

  // 3. Check for cycles
  for (const source of sources) {
    const visited = new Set<string>();
    let current: string | undefined = source.supersedes;
    while (current) {
      if (visited.has(current)) {
        throw new Error(
          `Cycle detected in supersession chain for fixture '${fixtureId}' at '${current}'`
        );
      }
      visited.add(current);
      current = byRevId.get(current)?.supersedes;
    }
  }

  // 4. Single connected predecessor chain covering every declared revision (no branching or gaps)
  for (const [sourceId, lineageSources] of sourcesBySourceId) {
    // Ensure no predecessor is superseded by multiple successors (no branching)
    const predecessorsCovered = new Set<string>();
    for (const s of lineageSources) {
      if (s.supersedes) {
        if (predecessorsCovered.has(s.supersedes)) {
          throw new Error(
            `Fixture '${fixtureId}' source lineage '${sourceId}' contains branching supersession: '${s.supersedes}' is superseded multiple times`
          );
        }
        predecessorsCovered.add(s.supersedes);
      }
    }

    // Trace from the leaf revision to ensure a single connected chain covering all revisions
    const supersededSet = new Set(lineageSources.map((s) => s.supersedes).filter(Boolean));
    const leaves = lineageSources.filter((s) => !supersededSet.has(s.sourceRevisionId));
    if (leaves.length !== 1) {
      throw new Error(
        `Fixture '${fixtureId}' source lineage '${sourceId}' does not form a single connected chain: found ${leaves.length} terminal revisions`
      );
    }

    const visitedInChain = new Set<string>();
    let currentInChain: string | undefined = leaves[0].sourceRevisionId;
    while (currentInChain) {
      visitedInChain.add(currentInChain);
      const node = byRevId.get(currentInChain);
      currentInChain = node?.supersedes;
    }

    if (visitedInChain.size !== lineageSources.length) {
      throw new Error(
        `Fixture '${fixtureId}' source lineage '${sourceId}' has disconnected revisions not reachable from the chain (visited ${visitedInChain.size} of ${lineageSources.length})`
      );
    }
  }
}

export interface ThresholdApprovalRule {
  readonly actor: string;
  readonly minThreshold: number;
  readonly maxThreshold?: number;
  readonly requiresApproval: boolean;
}

export function evaluateThresholdRuleConflict(
  ruleA: ThresholdApprovalRule,
  ruleB: ThresholdApprovalRule
): { isContradiction: boolean; reason: string } {
  // If both rules only require the same actor's approval at different lower bounds with no permission/exemption:
  if (ruleA.actor === ruleB.actor && ruleA.requiresApproval && ruleB.requiresApproval) {
    if (ruleA.minThreshold !== ruleB.minThreshold && !ruleA.maxThreshold && !ruleB.maxThreshold) {
      return {
        isContradiction: false,
        reason: `Compatible nested threshold rules: orders above ${Math.max(
          ruleA.minThreshold,
          ruleB.minThreshold
        )} require ${ruleA.actor} approval under both rules, and the stricter requirement is a compatible subset of the broader rule.`
      };
    }
  }

  // If one rule permits/exempts without actor approval up to maxThreshold while another mandates approval above minThreshold
  if (
    ruleA.actor === ruleB.actor &&
    ((!ruleA.requiresApproval && ruleB.requiresApproval) ||
      (ruleA.requiresApproval && !ruleB.requiresApproval))
  ) {
    const permitRule = !ruleA.requiresApproval ? ruleA : ruleB;
    const requireRule = ruleA.requiresApproval ? ruleA : ruleB;

    if (permitRule.maxThreshold && permitRule.maxThreshold > requireRule.minThreshold) {
      return {
        isContradiction: true,
        reason: `Mutually exclusive approval behavior on range (${requireRule.minThreshold}, ${permitRule.maxThreshold}]: one rule permits execution without ${permitRule.actor} approval while the other mandates ${requireRule.actor} approval.`
      };
    }
  }

  // Cross-actor conflict: e.g. Operations Director sign-off up to $50k without CFO review vs CFO required > $10k
  if (
    ruleA.actor !== ruleB.actor &&
    ((!ruleA.requiresApproval && ruleB.requiresApproval) ||
      (ruleA.requiresApproval && !ruleB.requiresApproval))
  ) {
    return {
      isContradiction: true,
      reason: 'Mutually exclusive cross-actor approval authority on overlapping transaction range.'
    };
  }

  return { isContradiction: false, reason: 'No mutual exclusivity detected.' };
}

describe('Supersession lineage validation unit tests', () => {
  it('rejects multiple disconnected roots for the same sourceId', () => {
    const malformedSources = [
      { sourceRevisionId: 'SRC-R1', sourceId: 'SRC', revision: 1 },
      { sourceRevisionId: 'SRC-R2', sourceId: 'SRC', revision: 2 } // Missing supersedes
    ];
    expect(() => validateSourceLineages(malformedSources)).toThrow(
      /must have exactly one root revision without supersedes, found 2/
    );
  });

  it('rejects duplicate revision ordinals within a source lineage', () => {
    const malformedSources = [
      { sourceRevisionId: 'SRC-R1', sourceId: 'SRC', revision: 1 },
      { sourceRevisionId: 'SRC-R2', sourceId: 'SRC', revision: 1, supersedes: 'SRC-R1' }
    ];
    expect(() => validateSourceLineages(malformedSources)).toThrow(
      /contains duplicate revision ordinals: \[1, 1\]/
    );
  });

  it('rejects branching supersession within a source lineage', () => {
    const malformedSources = [
      { sourceRevisionId: 'SRC-R1', sourceId: 'SRC', revision: 1 },
      { sourceRevisionId: 'SRC-R2', sourceId: 'SRC', revision: 2, supersedes: 'SRC-R1' },
      { sourceRevisionId: 'SRC-R3', sourceId: 'SRC', revision: 3, supersedes: 'SRC-R1' }
    ];
    expect(() => validateSourceLineages(malformedSources)).toThrow(
      /contains branching supersession: 'SRC-R1' is superseded multiple times/
    );
  });

  it('rejects disconnected or circular supersession chains', () => {
    // Cycle: R1 supersedes R2, R2 supersedes R1
    const cycleSources = [
      { sourceRevisionId: 'SRC-R1', sourceId: 'SRC', revision: 1, supersedes: 'SRC-R2' },
      { sourceRevisionId: 'SRC-R2', sourceId: 'SRC', revision: 2, supersedes: 'SRC-R1' }
    ];
    expect(() => validateSourceLineages(cycleSources)).toThrow(/must have exactly one root|Cycle/);

    // Predecessor with lower revision constraint violated
    const revDecrease = [
      { sourceRevisionId: 'SRC-R1', sourceId: 'SRC', revision: 5 },
      { sourceRevisionId: 'SRC-R2', sourceId: 'SRC', revision: 3, supersedes: 'SRC-R1' }
    ];
    expect(() => validateSourceLineages(revDecrease)).toThrow(
      /does not have strictly greater revision than predecessor/
    );

    // Predecessor from different sourceId
    const crossSource = [
      { sourceRevisionId: 'SRC-A-R1', sourceId: 'SRC-A', revision: 1 },
      { sourceRevisionId: 'SRC-B-R1', sourceId: 'SRC-B', revision: 1 },
      { sourceRevisionId: 'SRC-B-R2', sourceId: 'SRC-B', revision: 2, supersedes: 'SRC-A-R1' }
    ];
    expect(() => validateSourceLineages(crossSource)).toThrow(
      /supersedes 'SRC-A-R1' with different sourceId/
    );
  });
});

describe('Threshold conflict vs compatible nested rules semantic validation', () => {
  it('identifies compatible nested threshold rules as non-contradictory', () => {
    // Stricter range is a subset of broader rule; both statements can be simultaneously true
    const ruleAbove25k = {
      actor: 'Vice President',
      minThreshold: 25000,
      requiresApproval: true
    };
    const ruleAbove50k = {
      actor: 'Vice President',
      minThreshold: 50000,
      requiresApproval: true
    };

    const result = evaluateThresholdRuleConflict(ruleAbove25k, ruleAbove50k);
    expect(result.isContradiction).toBe(false);
    expect(result.reason).toContain('Compatible nested threshold rules');
  });

  it('identifies mutually exclusive permission and requirement rules as genuine contradictions', () => {
    // Basic fixture: <= $50k permits without VP approval vs > $25k requires VP approval
    const rulePermitUpTo50k = {
      actor: 'Department Vice President',
      minThreshold: 0,
      maxThreshold: 50000,
      requiresApproval: false
    };
    const ruleRequireAbove25k = {
      actor: 'Department Vice President',
      minThreshold: 25000,
      requiresApproval: true
    };

    const resultBasic = evaluateThresholdRuleConflict(rulePermitUpTo50k, ruleRequireAbove25k);
    expect(resultBasic.isContradiction).toBe(true);
    expect(resultBasic.reason).toContain(
      'Mutually exclusive approval behavior on range (25000, 50000]'
    );

    // Canonical messy fixture: <= $100k permits without CEO sign-off vs > $50k requires CEO sign-off
    const rulePermitUpTo100k = {
      actor: 'CEO',
      minThreshold: 0,
      maxThreshold: 100000,
      requiresApproval: false
    };
    const ruleRequireAbove50k = {
      actor: 'CEO',
      minThreshold: 50000,
      requiresApproval: true
    };

    const resultCanonical = evaluateThresholdRuleConflict(rulePermitUpTo100k, ruleRequireAbove50k);
    expect(resultCanonical.isContradiction).toBe(true);
    expect(resultCanonical.reason).toContain(
      'Mutually exclusive approval behavior on range (50000, 100000]'
    );

    // Cross-source fixture: Ops SOP permits up to $50k without CFO review vs Finance policy requires CFO > $10k
    const ruleCrossOps = {
      actor: 'Operations Director',
      minThreshold: 0,
      maxThreshold: 50000,
      requiresApproval: false
    };
    const ruleCrossFin = {
      actor: 'CFO',
      minThreshold: 10000,
      requiresApproval: true
    };

    const resultCross = evaluateThresholdRuleConflict(ruleCrossOps, ruleCrossFin);
    expect(resultCross.isContradiction).toBe(true);
    expect(resultCross.reason).toContain('Mutually exclusive cross-actor approval authority');
  });
});
