import type {
  EvaluationFixtureDto,
  ExpectedRequirementDto,
  ExpectedFindingDto,
  ExpectedNonFindingDto,
  EvidenceExpectationDto
} from '@solutions-studio/contracts';
import type { SourceLineageMap } from './validateSourceLineage.js';
import { normalizeEvidence } from './normalizeEvidence.js';

export interface NormalizedExpectedRequirement extends ExpectedRequirementDto {
  readonly declaredEvidence: readonly EvidenceExpectationDto[];
  readonly normalizedEvidence: readonly EvidenceExpectationDto[];
}

export interface NormalizedExpectedFinding extends ExpectedFindingDto {
  readonly declaredEvidence: readonly EvidenceExpectationDto[];
  readonly normalizedEvidence: readonly EvidenceExpectationDto[];
}

export interface NormalizedExpectedNonFinding extends ExpectedNonFindingDto {
  readonly declaredEvidence: readonly EvidenceExpectationDto[];
  readonly normalizedEvidence: readonly EvidenceExpectationDto[];
}

export interface NormalizedGroundTruth {
  readonly expectedRequirements: readonly NormalizedExpectedRequirement[];
  readonly expectedFindings: readonly NormalizedExpectedFinding[];
  readonly expectedNonFindings: readonly NormalizedExpectedNonFinding[];
}

export function normalizeExpectedGroundTruth(
  fixture: EvaluationFixtureDto,
  lineageMap: SourceLineageMap
): NormalizedGroundTruth {
  const expectedRequirements: NormalizedExpectedRequirement[] = fixture.expectedRequirements.map(
    (req) => {
      const normalizedEvidence = normalizeEvidence(
        req.evidence.map((e) => ({
          sourceRevisionId: lineageMap.resolveDeclared(e.sourceRevisionId),
          locator: e.locator
        }))
      );

      return Object.freeze({
        ...req,
        declaredEvidence: Object.freeze(normalizeEvidence(req.evidence)),
        normalizedEvidence: Object.freeze(normalizedEvidence)
      });
    }
  );

  const expectedFindings: NormalizedExpectedFinding[] = fixture.expectedFindings.map((finding) => {
    const normalizedEvidence = normalizeEvidence(
      finding.evidence.map((e) => ({
        sourceRevisionId: lineageMap.resolveDeclared(e.sourceRevisionId),
        locator: e.locator
      }))
    );

    return Object.freeze({
      ...finding,
      declaredEvidence: Object.freeze(normalizeEvidence(finding.evidence)),
      normalizedEvidence: Object.freeze(normalizedEvidence)
    });
  });

  const expectedNonFindings: NormalizedExpectedNonFinding[] = fixture.expectedNonFindings.map(
    (nonFinding) => {
      const normalizedEvidence = normalizeEvidence(
        nonFinding.evidence.map((e) => ({
          sourceRevisionId: lineageMap.resolveDeclared(e.sourceRevisionId),
          locator: e.locator
        }))
      );

      return Object.freeze({
        ...nonFinding,
        declaredEvidence: Object.freeze(normalizeEvidence(nonFinding.evidence)),
        normalizedEvidence: Object.freeze(normalizedEvidence)
      });
    }
  );

  return Object.freeze({
    expectedRequirements: Object.freeze(expectedRequirements),
    expectedFindings: Object.freeze(expectedFindings),
    expectedNonFindings: Object.freeze(expectedNonFindings)
  });
}
