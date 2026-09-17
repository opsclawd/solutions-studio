import {
  REQUIREMENT_CATEGORIES,
  type RequirementCategory,
  type RequirementRevision,
  type CandidateFinding
} from '@solutions-studio/domain';
import {
  FIXTURE_CATEGORIES,
  type FixtureCategoryDto,
  type FixtureScorerResultDto,
  type ScoreCountersDto,
  type RequirementMatchDetailDto,
  type RequirementMismatchDetailDto,
  type FindingMatchDetailDto,
  type FindingMismatchDetailDto,
  type RejectedCompilerRequirementDto,
  type RejectedCompilerFindingDto,
  type EvidenceExpectationDto,
  type CandidateFindingResponseDto
} from '@solutions-studio/contracts';
import type { NormalizedGroundTruth } from './normalizeExpectedGroundTruth.js';
import { areEvidenceSetsEqual, normalizeEvidence } from './normalizeEvidence.js';
import type {
  RejectedRequirement,
  RejectedFinding
} from '../use-cases/CompileRequirementsUseCase.js';

type NonEmptyEvidence = [EvidenceExpectationDto, ...EvidenceExpectationDto[]];

function computeScoreCounters(tp: number, fp: number, fn: number): ScoreCountersDto {
  const precision = tp + fp === 0 ? null : tp / (tp + fp);
  const recall = tp + fn === 0 ? null : tp / (tp + fn);
  const f1Score =
    precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : null;

  return {
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    precision,
    recall,
    f1Score
  };
}

export interface ScoreFixtureInput {
  readonly groundTruth: NormalizedGroundTruth;
  readonly observedRequirements: readonly RequirementRevision[];
  readonly observedFindings: readonly CandidateFinding[];
  readonly rejectedRequirements?: readonly RejectedRequirement[];
  readonly rejectedFindings?: readonly RejectedFinding[];
  readonly rawFindings?: readonly CandidateFindingResponseDto[];
}

export function scoreFixture(input: ScoreFixtureInput): FixtureScorerResultDto {
  const { groundTruth, observedRequirements, observedFindings } = input;

  // 1. Match requirements one-to-one
  const matchedRequirements: RequirementMatchDetailDto[] = [];
  const mismatchedRequirements: RequirementMismatchDetailDto[] = [];
  const matchedObservedReqIds = new Set<string>();
  const observedToExpectedReqKeyMap = new Map<string, string>();

  for (const expReq of groundTruth.expectedRequirements) {
    let foundMatch = false;

    for (const obsReq of observedRequirements) {
      if (matchedObservedReqIds.has(obsReq.id)) {
        continue;
      }

      if (obsReq.category !== expReq.category) {
        continue;
      }

      if (obsReq.origin !== expReq.origin) {
        continue;
      }

      const obsNormalizedEvidence = normalizeEvidence(obsReq.evidence);
      if (!areEvidenceSetsEqual(expReq.normalizedEvidence, obsNormalizedEvidence)) {
        continue;
      }

      // Match found!
      matchedObservedReqIds.add(obsReq.id);
      observedToExpectedReqKeyMap.set(obsReq.id, expReq.requirementKey);
      foundMatch = true;

      let statementPatternDiagnostic: { pattern: string; matched: boolean } | undefined = undefined;
      if (expReq.statementPattern) {
        try {
          const re = new RegExp(expReq.statementPattern);
          statementPatternDiagnostic = {
            pattern: expReq.statementPattern,
            matched: re.test(obsReq.statement)
          };
        } catch {
          statementPatternDiagnostic = {
            pattern: expReq.statementPattern,
            matched: false
          };
        }
      }

      matchedRequirements.push({
        expectedRequirementKey: expReq.requirementKey,
        observedRequirementRevisionId: obsReq.id,
        category: expReq.category,
        origin: expReq.origin,
        declaredEvidence: expReq.declaredEvidence as unknown as NonEmptyEvidence,
        normalizedEvidence: expReq.normalizedEvidence as unknown as NonEmptyEvidence,
        observedEvidence: obsNormalizedEvidence as unknown as NonEmptyEvidence,
        statement: obsReq.statement,
        statementPatternDiagnostic
      });

      break;
    }

    if (!foundMatch) {
      mismatchedRequirements.push({
        type: 'missing-expected',
        requirementKey: expReq.requirementKey,
        category: expReq.category,
        origin: expReq.origin,
        declaredEvidence: expReq.declaredEvidence as unknown as EvidenceExpectationDto[],
        normalizedEvidence: expReq.normalizedEvidence as unknown as EvidenceExpectationDto[],
        reason: 'missing-expected-candidate'
      });
    }
  }

  // Unmatched observed requirements are false positives
  for (const obsReq of observedRequirements) {
    if (!matchedObservedReqIds.has(obsReq.id)) {
      mismatchedRequirements.push({
        type: 'unmatched-observed',
        requirementRevisionId: obsReq.id,
        category: obsReq.category,
        origin: obsReq.origin,
        observedEvidence: normalizeEvidence(obsReq.evidence) as unknown as EvidenceExpectationDto[],
        statement: obsReq.statement,
        reason: 'unmatched-observed-candidate'
      });
    }
  }

  // 2. Match findings one-to-one
  const matchedFindings: FindingMatchDetailDto[] = [];
  const mismatchedFindings: FindingMismatchDetailDto[] = [];
  const unclassifiedFindings: FindingMismatchDetailDto[] = [];
  const matchedObservedFindingIds = new Set<string>();

  for (const expFinding of groundTruth.expectedFindings) {
    let foundMatch = false;
    const sortedExpRelated = [...expFinding.relatedRequirementKeys].sort();

    for (const obsFinding of observedFindings) {
      if (matchedObservedFindingIds.has(obsFinding.id)) {
        continue;
      }

      if (obsFinding.type !== expFinding.type) {
        continue;
      }

      const obsNormalizedEvidence = normalizeEvidence(obsFinding.evidence);
      if (!areEvidenceSetsEqual(expFinding.normalizedEvidence, obsNormalizedEvidence)) {
        continue;
      }

      // Map affected requirement revisions to expected requirement keys
      if (obsFinding.affectedRequirementRevisions.length !== sortedExpRelated.length) {
        continue;
      }

      let hasUnmappedAffectedRevision = false;
      const mappedRelatedKeys: string[] = [];
      for (const revId of obsFinding.affectedRequirementRevisions) {
        const expectedKey = observedToExpectedReqKeyMap.get(revId);
        if (!expectedKey) {
          hasUnmappedAffectedRevision = true;
          break;
        }
        mappedRelatedKeys.push(expectedKey);
      }

      if (hasUnmappedAffectedRevision) {
        continue;
      }

      mappedRelatedKeys.sort();

      if (
        sortedExpRelated.length !== mappedRelatedKeys.length ||
        sortedExpRelated.some((k, idx) => k !== mappedRelatedKeys[idx])
      ) {
        continue;
      }

      // Check raw finding related keys if available (to reject unknown extra targets)
      if (input.rawFindings) {
        const matchingRawFinding = input.rawFindings.find(
          (rf) =>
            rf.type === obsFinding.type &&
            areEvidenceSetsEqual(normalizeEvidence(rf.evidence), obsNormalizedEvidence)
        );
        if (
          matchingRawFinding &&
          matchingRawFinding.relatedRequirementKeys.length !== sortedExpRelated.length
        ) {
          continue;
        }
      }

      // Match found!
      matchedObservedFindingIds.add(obsFinding.id);
      foundMatch = true;

      matchedFindings.push({
        expectedFindingKey: expFinding.findingKey,
        observedFindingId: obsFinding.id,
        category: expFinding.category,
        type: expFinding.type,
        declaredEvidence: expFinding.declaredEvidence as unknown as NonEmptyEvidence,
        normalizedEvidence: expFinding.normalizedEvidence as unknown as NonEmptyEvidence,
        observedEvidence: obsNormalizedEvidence as unknown as NonEmptyEvidence,
        relatedRequirementKeys: expFinding.relatedRequirementKeys,
        rationale: obsFinding.rationale
      });

      break;
    }

    if (!foundMatch) {
      mismatchedFindings.push({
        type: 'missing-expected',
        findingKey: expFinding.findingKey,
        category: expFinding.category,
        domainType: expFinding.type,
        declaredEvidence: expFinding.declaredEvidence as unknown as EvidenceExpectationDto[],
        normalizedEvidence: expFinding.normalizedEvidence as unknown as EvidenceExpectationDto[],
        relatedRequirementKeys: expFinding.relatedRequirementKeys,
        reason: 'missing-expected-finding'
      });
    }
  }

  const TYPE_TO_CATEGORY_MAP: Partial<Record<string, FixtureCategoryDto>> = {
    'missing-authorization': 'missing-actors-authorization',
    'incomplete-state-machine': 'incomplete-state-transitions',
    'missing-failure-recovery': 'missing-failure-recovery',
    'temporal-ambiguity': 'temporal-ambiguity',
    'undefined-cardinality': 'undefined-cardinality',
    'unsupported-assumption': 'unsupported-assumptions'
  };

  function countEvidenceOverlap(
    obsEvidence: readonly EvidenceExpectationDto[],
    targetEvidence: readonly EvidenceExpectationDto[]
  ): number {
    let count = 0;
    for (const obsItem of obsEvidence) {
      if (
        targetEvidence.some(
          (targetItem) =>
            targetItem.sourceRevisionId === obsItem.sourceRevisionId &&
            targetItem.locator === obsItem.locator
        )
      ) {
        count++;
      }
    }
    return count;
  }

  function resolveFindingCategory(
    obsFinding: CandidateFinding,
    obsNormalizedEvidence: readonly EvidenceExpectationDto[],
    groundTruth: NormalizedGroundTruth
  ): FixtureCategoryDto | undefined {
    interface CandidateMatch {
      category: FixtureCategoryDto;
      overlapCount: number;
      isNonFinding: boolean;
    }

    const candidates: CandidateMatch[] = [];

    for (const nf of groundTruth.expectedNonFindings) {
      if (nf.wouldBeType === obsFinding.type) {
        const overlap = countEvidenceOverlap(obsNormalizedEvidence, nf.normalizedEvidence);
        if (overlap > 0) {
          candidates.push({
            category: nf.category,
            overlapCount: overlap,
            isNonFinding: true
          });
        }
      }
    }

    for (const ef of groundTruth.expectedFindings) {
      if (ef.type === obsFinding.type) {
        const overlap = countEvidenceOverlap(obsNormalizedEvidence, ef.normalizedEvidence);
        if (overlap > 0) {
          candidates.push({
            category: ef.category,
            overlapCount: overlap,
            isNonFinding: false
          });
        }
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        if (b.overlapCount !== a.overlapCount) {
          return b.overlapCount - a.overlapCount;
        }
        if (b.isNonFinding !== a.isNonFinding) {
          return b.isNonFinding ? 1 : -1;
        }
        return a.category.localeCompare(b.category);
      });

      return candidates[0].category;
    }

    // No evidence overlap: check 1-to-1 finding type mapping
    const mappedCategory = TYPE_TO_CATEGORY_MAP[obsFinding.type];
    if (mappedCategory) {
      return mappedCategory;
    }

    // If type is contradiction, check if the fixture context only has a single contradiction category
    if (obsFinding.type === 'contradiction') {
      const fixtureContradictionCategories = new Set<FixtureCategoryDto>();
      for (const nf of groundTruth.expectedNonFindings) {
        if (nf.wouldBeType === 'contradiction') {
          fixtureContradictionCategories.add(nf.category);
        }
      }
      for (const ef of groundTruth.expectedFindings) {
        if (ef.type === 'contradiction') {
          fixtureContradictionCategories.add(ef.category);
        }
      }

      if (fixtureContradictionCategories.size === 1) {
        return Array.from(fixtureContradictionCategories)[0];
      }
    }

    return undefined;
  }

  // Unmatched observed findings: check against expected non-findings or unclassified
  for (const obsFinding of observedFindings) {
    if (matchedObservedFindingIds.has(obsFinding.id)) {
      continue;
    }

    const obsNormalizedEvidence = normalizeEvidence(obsFinding.evidence);
    let matchedNonFinding = false;

    for (const nonFinding of groundTruth.expectedNonFindings) {
      if (obsFinding.type !== nonFinding.wouldBeType) {
        continue;
      }

      if (areEvidenceSetsEqual(nonFinding.normalizedEvidence, obsNormalizedEvidence)) {
        matchedNonFinding = true;
        mismatchedFindings.push({
          type: 'matched-expected-non-finding',
          findingId: obsFinding.id,
          category: nonFinding.category,
          domainType: obsFinding.type,
          observedEvidence: obsNormalizedEvidence as unknown as EvidenceExpectationDto[],
          affectedRequirementRevisions: [...obsFinding.affectedRequirementRevisions],
          matchedNonFindingDescription: nonFinding.description,
          reason: 'matched-expected-non-finding'
        });
        break;
      }
    }

    if (!matchedNonFinding) {
      const resolvedCategory = resolveFindingCategory(
        obsFinding,
        obsNormalizedEvidence,
        groundTruth
      );

      const unclassifiedDetail: FindingMismatchDetailDto = {
        type: 'unclassified-observed',
        findingId: obsFinding.id,
        category: resolvedCategory,
        domainType: obsFinding.type,
        observedEvidence: obsNormalizedEvidence as unknown as EvidenceExpectationDto[],
        affectedRequirementRevisions: [...obsFinding.affectedRequirementRevisions],
        reason: 'unmatched-finding-unclassified'
      };
      mismatchedFindings.push(unclassifiedDetail);
      unclassifiedFindings.push(unclassifiedDetail);
    }
  }

  // 3. Aggregate requirement counters by category
  const requirementsByCategory = {} as Record<RequirementCategory, ScoreCountersDto>;
  for (const cat of REQUIREMENT_CATEGORIES) {
    const tp = matchedRequirements.filter((m) => m.category === cat).length;
    const fp = mismatchedRequirements.filter(
      (m) => m.type === 'unmatched-observed' && m.category === cat
    ).length;
    const fn = mismatchedRequirements.filter(
      (m) => m.type === 'missing-expected' && m.category === cat
    ).length;
    requirementsByCategory[cat] = computeScoreCounters(tp, fp, fn);
  }

  // 4. Aggregate finding counters by category
  const findingsByCategory = {} as Record<FixtureCategoryDto, ScoreCountersDto>;
  for (const cat of FIXTURE_CATEGORIES) {
    const tp = matchedFindings.filter((m) => m.category === cat).length;
    const fp = mismatchedFindings.filter(
      (m) =>
        (m.type === 'matched-expected-non-finding' || m.type === 'unclassified-observed') &&
        m.category === cat
    ).length;
    const fn = mismatchedFindings.filter(
      (m) => m.type === 'missing-expected' && m.category === cat
    ).length;
    findingsByCategory[cat] = computeScoreCounters(tp, fp, fn);
  }

  // 5. Rejected candidates
  const rejectedCompilerRequirements: RejectedCompilerRequirementDto[] = (
    input.rejectedRequirements ?? []
  ).map((r) => ({
    requirementKey: r.requirementKey,
    errorName: r.error.name,
    errorMessage: r.error.message,
    candidate: r.candidate
  }));

  const rejectedCompilerFindings: RejectedCompilerFindingDto[] = (input.rejectedFindings ?? []).map(
    (f) => ({
      findingKey: f.findingKey,
      errorName: f.error.name,
      errorMessage: f.error.message,
      candidate: f.candidate
    })
  );

  return {
    requirementsByCategory,
    findingsByCategory,
    unclassifiedFindingsCount: unclassifiedFindings.length,
    matchedRequirements,
    mismatchedRequirements,
    matchedFindings,
    mismatchedFindings,
    unclassifiedFindings,
    rejectedCompilerRequirements,
    rejectedCompilerFindings
  };
}
