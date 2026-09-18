import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSourceId, createSourceRevisionId } from '@solutions-studio/domain';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeGenerationGateway } from '../fakes/FakeGenerationGateway.js';
import { CompileRequirementsUseCase } from '../../src/application/use-cases/CompileRequirementsUseCase.js';
import {
  EmptySourceRevisionIdsError,
  MalformedGenerationOutputError,
  UnknownSourceRevisionError,
  UnresolvedLocatorError,
  InvalidEvidencelessOriginError,
  UnresolvedRequirementKeyError
} from '../../src/application/use-cases/CompileRequirementsErrors.js';
import { NonZeroExitError } from '../../src/application/ports/generation/GenerationErrors.js';

describe('CompileRequirementsUseCase', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let fakeGateway: FakeGenerationGateway;
  let useCase: CompileRequirementsUseCase;

  const markdownContent = `# Operational Guidelines

## Safety Inspection

All equipment must undergo secondary pressure inspection before deployment.
`;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'compile-usecase-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    fakeGateway = new FakeGenerationGateway();
    useCase = new CompileRequirementsUseCase(fakeGateway, repo);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('1. successfully compiles candidate requirements and findings with valid provenance', async () => {
    const record = await repo.captureSourceRevision({
      sourceId: createSourceId('SPEC-001'),
      sourceType: 'sop',
      markdownText: markdownContent
    });

    const validLocator = record.locatorIndex[0].locator;
    const responseJson = JSON.stringify({
      requirements: [
        {
          requirementKey: 'REQ-1',
          statement: 'All equipment must undergo secondary pressure inspection before deployment.',
          category: 'business-rule',
          origin: 'EXPLICIT',
          evidence: [
            {
              sourceRevisionId: record.revision.id,
              locator: validLocator
            }
          ],
          rationale: 'Mandated by safety inspection guidelines'
        }
      ],
      findings: []
    });

    fakeGateway.queueResponse(responseJson);

    const result = await useCase.compile({
      sourceRevisionIds: [record.revision.id]
    });

    expect(result.acceptedRequirementRevisions).toHaveLength(1);
    expect(result.rejectedRequirements).toHaveLength(0);
    expect(result.acceptedFindingIds).toHaveLength(0);
    expect(result.rejectedFindings).toHaveLength(0);

    const revId = result.acceptedRequirementRevisions[0];
    const persisted = await repo.getRequirementRevision(revId);
    expect(persisted).toBeDefined();
    expect(persisted!.statement).toBe(
      'All equipment must undergo secondary pressure inspection before deployment.'
    );
    expect(persisted!.category).toBe('business-rule');
    expect(persisted!.origin).toBe('EXPLICIT');
    expect(persisted!.reviewState).toBe('PENDING');
    expect(persisted!.resolutionState).toBe('UNRESOLVED');
    expect(persisted!.revision).toBe(1);
    expect(persisted!.evidence).toHaveLength(1);
    expect(persisted!.evidence[0].sourceRevisionId).toBe(record.revision.id);
    expect(persisted!.evidence[0].locator).toBe(validLocator);
    expect(persisted!.rationale).toBe('Mandated by safety inspection guidelines');
  });

  it('2. rejects with MalformedGenerationOutputError when gateway output is malformed or invalid JSON', async () => {
    const record = await repo.captureSourceRevision({
      sourceId: createSourceId('SPEC-001'),
      sourceType: 'sop',
      markdownText: markdownContent
    });

    fakeGateway.queueResponse('Not valid JSON at all!');

    await expect(useCase.compile({ sourceRevisionIds: [record.revision.id] })).rejects.toThrow(
      MalformedGenerationOutputError
    );

    // Assert schema mismatch also fails with MalformedGenerationOutputError
    fakeGateway.queueResponse(JSON.stringify({ requirements: 'not-an-array' }));

    await expect(useCase.compile({ sourceRevisionIds: [record.revision.id] })).rejects.toThrow(
      MalformedGenerationOutputError
    );

    // Verify nothing was persisted
    expect(await repo.listCandidateFindings()).toHaveLength(0);
  });

  it('3. isolates per-candidate rejection when evidence references an unknown source revision', async () => {
    const record = await repo.captureSourceRevision({
      sourceId: createSourceId('SPEC-001'),
      sourceType: 'sop',
      markdownText: markdownContent
    });

    const validLocator = record.locatorIndex[0].locator;
    const responseJson = JSON.stringify({
      requirements: [
        {
          requirementKey: 'REQ-BAD',
          statement: 'Requirement with non-existent source revision',
          category: 'business-rule',
          origin: 'EXPLICIT',
          evidence: [
            {
              sourceRevisionId: 'NON-EXISTENT-REV-999',
              locator: validLocator
            }
          ]
        },
        {
          requirementKey: 'REQ-GOOD',
          statement: 'Requirement with valid source revision',
          category: 'business-rule',
          origin: 'EXPLICIT',
          evidence: [
            {
              sourceRevisionId: record.revision.id,
              locator: validLocator
            }
          ]
        }
      ],
      findings: []
    });

    fakeGateway.queueResponse(responseJson);

    const result = await useCase.compile({
      sourceRevisionIds: [record.revision.id]
    });

    expect(result.rejectedRequirements).toHaveLength(1);
    expect(result.rejectedRequirements[0].requirementKey).toBe('REQ-BAD');
    expect(result.rejectedRequirements[0].error).toBeInstanceOf(UnknownSourceRevisionError);
    expect(
      (result.rejectedRequirements[0].error as UnknownSourceRevisionError).sourceRevisionId
    ).toBe('NON-EXISTENT-REV-999');

    expect(result.acceptedRequirementRevisions).toHaveLength(1);
    const goodRev = await repo.getRequirementRevision(result.acceptedRequirementRevisions[0]);
    expect(goodRev).toBeDefined();
    expect(goodRev!.statement).toBe('Requirement with valid source revision');
  });

  it('4. rejects candidate with UnresolvedLocatorError when locator is absent from source revision index', async () => {
    const record = await repo.captureSourceRevision({
      sourceId: createSourceId('SPEC-001'),
      sourceType: 'sop',
      markdownText: markdownContent
    });

    const responseJson = JSON.stringify({
      requirements: [
        {
          requirementKey: 'REQ-BAD-LOC',
          statement: 'Requirement with missing locator',
          category: 'business-rule',
          origin: 'EXPLICIT',
          evidence: [
            {
              sourceRevisionId: record.revision.id,
              locator: 'non-existent-locator#42'
            }
          ]
        }
      ],
      findings: []
    });

    fakeGateway.queueResponse(responseJson);

    const result = await useCase.compile({
      sourceRevisionIds: [record.revision.id]
    });

    expect(result.acceptedRequirementRevisions).toHaveLength(0);
    expect(result.rejectedRequirements).toHaveLength(1);
    expect(result.rejectedRequirements[0].requirementKey).toBe('REQ-BAD-LOC');
    expect(result.rejectedRequirements[0].error).toBeInstanceOf(UnresolvedLocatorError);
    const err = result.rejectedRequirements[0].error as UnresolvedLocatorError;
    expect(err.sourceRevisionId).toBe(record.revision.id);
    expect(err.locator).toBe('non-existent-locator#42');
  });

  it('5. allows ASSUMED and GENERATED_PROPOSAL without evidence, but rejects EXPLICIT/INFERRED without evidence', async () => {
    const record = await repo.captureSourceRevision({
      sourceId: createSourceId('SPEC-001'),
      sourceType: 'sop',
      markdownText: markdownContent
    });

    const responseJson = JSON.stringify({
      requirements: [
        {
          requirementKey: 'REQ-ASSUMED',
          statement: 'Operational assumption statement',
          category: 'data-constraint',
          origin: 'ASSUMED',
          evidence: []
        },
        {
          requirementKey: 'REQ-PROPOSAL',
          statement: 'Generated proposal statement',
          category: 'business-rule',
          origin: 'GENERATED_PROPOSAL',
          evidence: []
        },
        {
          requirementKey: 'REQ-EXPLICIT-NO-EVID',
          statement: 'Explicit without evidence',
          category: 'business-rule',
          origin: 'EXPLICIT',
          evidence: []
        },
        {
          requirementKey: 'REQ-INFERRED-NO-EVID',
          statement: 'Inferred without evidence',
          category: 'business-rule',
          origin: 'INFERRED',
          evidence: []
        }
      ],
      findings: []
    });

    fakeGateway.queueResponse(responseJson);

    const result = await useCase.compile({
      sourceRevisionIds: [record.revision.id]
    });

    // ASSUMED and GENERATED_PROPOSAL accepted
    expect(result.acceptedRequirementRevisions).toHaveLength(2);
    const rev1 = await repo.getRequirementRevision(result.acceptedRequirementRevisions[0]);
    expect(rev1!.origin).toBe('ASSUMED');
    expect(rev1!.evidence).toHaveLength(0);

    const rev2 = await repo.getRequirementRevision(result.acceptedRequirementRevisions[1]);
    expect(rev2!.origin).toBe('GENERATED_PROPOSAL');
    expect(rev2!.evidence).toHaveLength(0);

    // EXPLICIT and INFERRED without evidence rejected
    expect(result.rejectedRequirements).toHaveLength(2);
    expect(result.rejectedRequirements[0].requirementKey).toBe('REQ-EXPLICIT-NO-EVID');
    expect(result.rejectedRequirements[0].error).toBeInstanceOf(InvalidEvidencelessOriginError);

    expect(result.rejectedRequirements[1].requirementKey).toBe('REQ-INFERRED-NO-EVID');
    expect(result.rejectedRequirements[1].error).toBeInstanceOf(InvalidEvidencelessOriginError);
  });

  it('6. compiles and persists CandidateFinding records linked to requirements with OPEN disposition', async () => {
    const record = await repo.captureSourceRevision({
      sourceId: createSourceId('SPEC-001'),
      sourceType: 'sop',
      markdownText: markdownContent
    });

    const validLocator = record.locatorIndex[0].locator;
    const responseJson = JSON.stringify({
      requirements: [
        {
          requirementKey: 'REQ-1',
          statement: 'Inspection requirement',
          category: 'business-rule',
          origin: 'EXPLICIT',
          evidence: [{ sourceRevisionId: record.revision.id, locator: validLocator }]
        }
      ],
      findings: [
        {
          findingKey: 'FINDING-1',
          type: 'contradiction',
          relatedRequirementKeys: ['REQ-1'],
          evidence: [{ sourceRevisionId: record.revision.id, locator: validLocator }],
          rationale: 'Contradicts standard emergency bypass rule'
        }
      ]
    });

    fakeGateway.queueResponse(responseJson);

    const result = await useCase.compile({
      sourceRevisionIds: [record.revision.id]
    });

    expect(result.acceptedFindingIds).toHaveLength(1);
    expect(result.rejectedFindings).toHaveLength(0);

    const finding = await repo.getCandidateFinding(result.acceptedFindingIds[0]);
    expect(finding).toBeDefined();
    expect(finding!.type).toBe('contradiction');
    expect(finding!.discoveredBy).toBe('model');
    expect(finding!.disposition).toBe('OPEN');
    expect(finding!.rationale).toBe('Contradicts standard emergency bypass rule');
    expect(finding!.affectedRequirementRevisions).toHaveLength(1);
    expect(finding!.affectedRequirementRevisions[0]).toBe(result.acceptedRequirementRevisions[0]);
  });

  it('7. propagates generation provider failures without persisting partial state', async () => {
    const record = await repo.captureSourceRevision({
      sourceId: createSourceId('SPEC-001'),
      sourceType: 'sop',
      markdownText: markdownContent
    });

    fakeGateway.queueError(new NonZeroExitError(1, 'Provider connection error', ''));

    await expect(useCase.compile({ sourceRevisionIds: [record.revision.id] })).rejects.toThrow(
      NonZeroExitError
    );

    expect(await repo.listCandidateFindings()).toHaveLength(0);
  });

  it('8. prevents model from self-granting authority (reviewState defaults to PENDING, disposition to OPEN)', async () => {
    const record = await repo.captureSourceRevision({
      sourceId: createSourceId('SPEC-001'),
      sourceType: 'sop',
      markdownText: markdownContent
    });

    const validLocator = record.locatorIndex[0].locator;
    // Inject reviewState: ACCEPTED and disposition: RESOLVED
    const responseJson = JSON.stringify({
      requirements: [
        {
          requirementKey: 'REQ-1',
          statement: 'Attempted self-acceptance',
          category: 'business-rule',
          origin: 'EXPLICIT',
          reviewState: 'ACCEPTED',
          evidence: [{ sourceRevisionId: record.revision.id, locator: validLocator }]
        }
      ],
      findings: [
        {
          findingKey: 'FINDING-1',
          type: 'contradiction',
          relatedRequirementKeys: ['REQ-1'],
          disposition: 'RESOLVED',
          evidence: [{ sourceRevisionId: record.revision.id, locator: validLocator }],
          rationale: 'Attempted self-resolved finding'
        }
      ]
    });

    fakeGateway.queueResponse(responseJson);

    const result = await useCase.compile({
      sourceRevisionIds: [record.revision.id]
    });

    const req = await repo.getRequirementRevision(result.acceptedRequirementRevisions[0]);
    expect(req!.reviewState).toBe('PENDING');

    const finding = await repo.getCandidateFinding(result.acceptedFindingIds[0]);
    expect(finding!.disposition).toBe('OPEN');
  });

  it('9. rejects findings with UnresolvedRequirementKeyError when declared relatedRequirementKeys fail to resolve (Bug 2 fix)', async () => {
    const record = await repo.captureSourceRevision({
      sourceId: createSourceId('SPEC-001'),
      sourceType: 'sop',
      markdownText: markdownContent
    });

    const validLocator = record.locatorIndex[0].locator;
    const responseJson = JSON.stringify({
      requirements: [
        {
          requirementKey: 'REQ-BAD',
          statement: 'Invalid requirement',
          category: 'business-rule',
          origin: 'EXPLICIT',
          evidence: [{ sourceRevisionId: record.revision.id, locator: 'invalid-locator#99' }]
        }
      ],
      findings: [
        {
          findingKey: 'FINDING-1',
          type: 'missing-authorization',
          relatedRequirementKeys: ['REQ-BAD'],
          evidence: [{ sourceRevisionId: record.revision.id, locator: validLocator }],
          rationale: 'Finding pointing to an invalid requirement'
        }
      ]
    });

    fakeGateway.queueResponse(responseJson);

    const result = await useCase.compile({
      sourceRevisionIds: [record.revision.id]
    });

    expect(result.rejectedRequirements).toHaveLength(1);
    expect(result.acceptedFindingIds).toHaveLength(0);
    expect(result.rejectedFindings).toHaveLength(1);
    expect(result.rejectedFindings[0].findingKey).toBe('FINDING-1');
    expect(result.rejectedFindings[0].error).toBeInstanceOf(UnresolvedRequirementKeyError);
    const unmappedErr = result.rejectedFindings[0].error as UnresolvedRequirementKeyError;
    expect(unmappedErr.findingKey).toBe('FINDING-1');
    expect(unmappedErr.unmappedRequirementKeys).toEqual(['REQ-BAD']);

    // Finding was not saved into repository
    expect(await repo.listCandidateFindings()).toHaveLength(0);
  });

  it('9b. retains intentionally unscoped findings (relatedRequirementKeys: []) as accepted OPEN findings', async () => {
    const record = await repo.captureSourceRevision({
      sourceId: createSourceId('SPEC-001'),
      sourceType: 'sop',
      markdownText: markdownContent
    });

    const validLocator = record.locatorIndex[0].locator;
    const responseJson = JSON.stringify({
      requirements: [],
      findings: [
        {
          findingKey: 'FINDING-UNSCOPED',
          type: 'missing-authorization',
          relatedRequirementKeys: [],
          evidence: [{ sourceRevisionId: record.revision.id, locator: validLocator }],
          rationale: 'Intentionally unscoped global finding'
        }
      ]
    });

    fakeGateway.queueResponse(responseJson);

    const result = await useCase.compile({
      sourceRevisionIds: [record.revision.id]
    });

    expect(result.acceptedFindingIds).toHaveLength(1);
    expect(result.rejectedFindings).toHaveLength(0);

    const finding = await repo.getCandidateFinding(result.acceptedFindingIds[0]);
    expect(finding).toBeDefined();
    expect(finding!.affectedRequirementRevisions).toEqual([]);
    expect(finding!.disposition).toBe('OPEN');
  });

  it('9c. accepts findings with mixed relatedRequirementKeys where at least one resolves, linking only resolved revisions', async () => {
    const record = await repo.captureSourceRevision({
      sourceId: createSourceId('SPEC-001'),
      sourceType: 'sop',
      markdownText: markdownContent
    });

    const validLocator = record.locatorIndex[0].locator;
    const responseJson = JSON.stringify({
      requirements: [
        {
          requirementKey: 'K1',
          statement: 'Valid requirement',
          category: 'business-rule',
          origin: 'EXPLICIT',
          evidence: [{ sourceRevisionId: record.revision.id, locator: validLocator }]
        }
      ],
      findings: [
        {
          findingKey: 'FINDING-MIXED',
          type: 'contradiction',
          relatedRequirementKeys: ['K1', 'K2-UNKNOWN'],
          evidence: [{ sourceRevisionId: record.revision.id, locator: validLocator }],
          rationale: 'Contradiction between K1 and unknown key'
        }
      ]
    });

    fakeGateway.queueResponse(responseJson);

    const result = await useCase.compile({
      sourceRevisionIds: [record.revision.id]
    });

    expect(result.acceptedRequirementRevisions).toHaveLength(1);
    expect(result.acceptedFindingIds).toHaveLength(1);
    expect(result.rejectedFindings).toHaveLength(0);

    const finding = await repo.getCandidateFinding(result.acceptedFindingIds[0]);
    expect(finding).toBeDefined();
    expect(finding!.affectedRequirementRevisions).toEqual([result.acceptedRequirementRevisions[0]]);
  });

  it('9d. repro Bug 2: unresolvable typo key rejects finding into rejectedFindings rather than silently producing orphan finding', async () => {
    const record = await repo.captureSourceRevision({
      sourceId: createSourceId('SPEC-001'),
      sourceType: 'sop',
      markdownText: markdownContent
    });

    const validLocator = record.locatorIndex[0].locator;
    const responseJson = JSON.stringify({
      requirements: [
        {
          requirementKey: 'k1',
          statement: 'Requirement k1',
          category: 'business-rule',
          origin: 'EXPLICIT',
          evidence: [{ sourceRevisionId: record.revision.id, locator: validLocator }]
        }
      ],
      findings: [
        {
          findingKey: 'f1',
          type: 'contradiction',
          relatedRequirementKeys: ['K1-typo'],
          evidence: [{ sourceRevisionId: record.revision.id, locator: validLocator }],
          rationale: 'Contradiction referencing typo key'
        }
      ]
    });

    fakeGateway.queueResponse(responseJson);

    const result = await useCase.compile({
      sourceRevisionIds: [record.revision.id]
    });

    expect(result.acceptedRequirementRevisions).toHaveLength(1);
    expect(result.acceptedFindingIds).toHaveLength(0);
    expect(result.rejectedFindings).toHaveLength(1);
    expect(result.rejectedFindings[0].findingKey).toBe('f1');
    expect(result.rejectedFindings[0].error).toBeInstanceOf(UnresolvedRequirementKeyError);
    expect(
      (result.rejectedFindings[0].error as UnresolvedRequirementKeyError).unmappedRequirementKeys
    ).toEqual(['K1-typo']);
  });

  it('repro Bug 5: evidence citing a source revision outside compile scope is rejected with UnknownSourceRevisionError', async () => {
    const md1 = `# Doc\n\nVersion 1 text.`;
    const md2 = `# Doc\n\nVersion 2 text with changes.`;
    const sourceId = createSourceId('SPEC-SCOPE');

    const rec1 = await repo.captureSourceRevision({
      sourceId,
      sourceType: 'sop',
      markdownText: md1
    });
    const rec2 = await repo.captureSourceRevision({
      sourceId,
      sourceType: 'sop',
      markdownText: md2
    });

    expect(rec1.revision.id).toBe('SPEC-SCOPE-R1');
    expect(rec2.revision.id).toBe('SPEC-SCOPE-R2');

    const loc1 = rec1.locatorIndex[0].locator;
    const loc2 = rec2.locatorIndex[0].locator;

    // Both rec1 and rec2 exist in the repository!
    // But compile() is explicitly scoped ONLY to [rec2.revision.id]
    const responseJson = JSON.stringify({
      requirements: [
        {
          requirementKey: 'REQ-OUT-OF-SCOPE',
          statement: 'Requirement citing superseded R1 outside compile scope',
          category: 'business-rule',
          origin: 'EXPLICIT',
          evidence: [
            {
              sourceRevisionId: rec1.revision.id, // Exists in storage, but NOT in input.sourceRevisionIds!
              locator: loc1
            }
          ]
        },
        {
          requirementKey: 'REQ-IN-SCOPE',
          statement: 'Requirement citing in-scope R2',
          category: 'business-rule',
          origin: 'EXPLICIT',
          evidence: [
            {
              sourceRevisionId: rec2.revision.id,
              locator: loc2
            }
          ]
        }
      ],
      findings: [
        {
          findingKey: 'FINDING-OUT-OF-SCOPE',
          type: 'contradiction',
          relatedRequirementKeys: [],
          evidence: [
            {
              sourceRevisionId: rec1.revision.id, // Out of scope
              locator: loc1
            }
          ],
          rationale: 'Finding citing out-of-scope revision'
        }
      ]
    });

    fakeGateway.queueResponse(responseJson);

    const result = await useCase.compile({
      sourceRevisionIds: [rec2.revision.id]
    });

    // REQ-OUT-OF-SCOPE is rejected
    expect(result.rejectedRequirements).toHaveLength(1);
    expect(result.rejectedRequirements[0].requirementKey).toBe('REQ-OUT-OF-SCOPE');
    expect(result.rejectedRequirements[0].error).toBeInstanceOf(UnknownSourceRevisionError);
    expect(
      (result.rejectedRequirements[0].error as UnknownSourceRevisionError).sourceRevisionId
    ).toBe(rec1.revision.id);

    // REQ-IN-SCOPE is accepted
    expect(result.acceptedRequirementRevisions).toHaveLength(1);

    // FINDING-OUT-OF-SCOPE is rejected
    expect(result.rejectedFindings).toHaveLength(1);
    expect(result.rejectedFindings[0].findingKey).toBe('FINDING-OUT-OF-SCOPE');
    expect(result.rejectedFindings[0].error).toBeInstanceOf(UnknownSourceRevisionError);
    expect((result.rejectedFindings[0].error as UnknownSourceRevisionError).sourceRevisionId).toBe(
      rec1.revision.id
    );
  });

  it('repro Bug 6: compiler rejects model output claiming origin REVIEWER_PROPOSAL as MalformedGenerationOutputError', async () => {
    const record = await repo.captureSourceRevision({
      sourceId: createSourceId('SPEC-001'),
      sourceType: 'sop',
      markdownText: markdownContent
    });

    const validLocator = record.locatorIndex[0].locator;
    const responseJson = JSON.stringify({
      requirements: [
        {
          requirementKey: 'REQ-MODEL-CLAIM',
          statement: 'Model attempting to claim human authority',
          category: 'business-rule',
          origin: 'REVIEWER_PROPOSAL',
          evidence: [{ sourceRevisionId: record.revision.id, locator: validLocator }]
        }
      ],
      findings: []
    });

    fakeGateway.queueResponse(responseJson);

    await expect(
      useCase.compile({
        sourceRevisionIds: [record.revision.id]
      })
    ).rejects.toThrow(MalformedGenerationOutputError);

    expect(await repo.listCandidateFindings()).toHaveLength(0);
  });

  it('10. throws EmptySourceRevisionIdsError synchronously when sourceRevisionIds is empty', async () => {
    await expect(useCase.compile({ sourceRevisionIds: [] })).rejects.toThrow(
      EmptySourceRevisionIdsError
    );

    expect(fakeGateway.recordedRequests).toHaveLength(0);
    expect(await repo.listCandidateFindings()).toHaveLength(0);
  });

  it('11. safely catches path-traversal-shaped evidence identifiers and treats them as typed failures', async () => {
    const record = await repo.captureSourceRevision({
      sourceId: createSourceId('SPEC-001'),
      sourceType: 'sop',
      markdownText: markdownContent
    });

    const validLocator = record.locatorIndex[0].locator;
    const responseJson = JSON.stringify({
      requirements: [
        {
          requirementKey: 'REQ-TRAVERSAL-REV',
          statement: 'Traversal in sourceRevisionId',
          category: 'business-rule',
          origin: 'EXPLICIT',
          evidence: [{ sourceRevisionId: '../../traversal', locator: validLocator }]
        },
        {
          requirementKey: 'REQ-TRAVERSAL-LOC',
          statement: 'Traversal in locator',
          category: 'business-rule',
          origin: 'EXPLICIT',
          evidence: [{ sourceRevisionId: record.revision.id, locator: '../../etc/passwd' }]
        }
      ],
      findings: []
    });

    fakeGateway.queueResponse(responseJson);

    // Must resolve cleanly without uncaught unhandled exceptions
    const result = await useCase.compile({
      sourceRevisionIds: [record.revision.id]
    });

    expect(result.acceptedRequirementRevisions).toHaveLength(0);
    expect(result.rejectedRequirements).toHaveLength(2);

    expect(result.rejectedRequirements[0].requirementKey).toBe('REQ-TRAVERSAL-REV');
    expect(result.rejectedRequirements[0].error).toBeInstanceOf(UnknownSourceRevisionError);

    expect(result.rejectedRequirements[1].requirementKey).toBe('REQ-TRAVERSAL-LOC');
    expect(result.rejectedRequirements[1].error).toBeInstanceOf(UnresolvedLocatorError);
  });

  it('12. preserves generationMetadata when provided, and leaves it undefined when absent', async () => {
    const record = await repo.captureSourceRevision({
      sourceId: createSourceId('SPEC-001'),
      sourceType: 'sop',
      markdownText: markdownContent
    });

    const validLocator = record.locatorIndex[0].locator;
    const responseJson = JSON.stringify({
      requirements: [
        {
          requirementKey: 'REQ-1',
          statement: 'Valid statement',
          category: 'business-rule',
          origin: 'EXPLICIT',
          evidence: [{ sourceRevisionId: record.revision.id, locator: validLocator }]
        }
      ],
      findings: []
    });

    // Case A: metadata provided
    const measuredMetadata = {
      provider: 'custom-ai-provider',
      model: 'model-v2.1',
      durationMs: 350,
      tokens: { input: 120, output: 45, total: 165 }
    };
    fakeGateway.queueResponse(responseJson, measuredMetadata);

    const resultWithMeta = await useCase.compile({
      sourceRevisionIds: [record.revision.id]
    });
    expect(resultWithMeta.generationMetadata).toEqual(measuredMetadata);

    // Case B: metadata absent
    fakeGateway.queueResponse(responseJson); // no metadata argument

    const resultWithoutMeta = await useCase.compile({
      sourceRevisionIds: [record.revision.id]
    });
    expect(resultWithoutMeta.generationMetadata).toBeUndefined();
  });

  it('13. rejects caller input with UnknownSourceRevisionError when specified source revision does not exist', async () => {
    await expect(
      useCase.compile({
        sourceRevisionIds: [createSourceRevisionId('NON-EXISTENT-CALLER-REV')]
      })
    ).rejects.toThrow(UnknownSourceRevisionError);

    expect(fakeGateway.recordedRequests).toHaveLength(0);
  });

  it('14. extracts JSON correctly even when surrounded by markdown fences and commentary', async () => {
    const record = await repo.captureSourceRevision({
      sourceId: createSourceId('SPEC-001'),
      sourceType: 'sop',
      markdownText: markdownContent
    });

    const validLocator = record.locatorIndex[0].locator;
    const responseText = `Here is the requested compilation:

\`\`\`json
{
  "requirements": [
    {
      "requirementKey": "REQ-1",
      "statement": "Valid requirement statement",
      "category": "business-rule",
      "origin": "EXPLICIT",
      "evidence": [{ "sourceRevisionId": "${record.revision.id}", "locator": "${validLocator}" }]
    }
  ],
  "findings": []
}
\`\`\`

Hope this meets your requirements!`;

    fakeGateway.queueResponse(responseText);

    const result = await useCase.compile({
      sourceRevisionIds: [record.revision.id]
    });

    expect(result.acceptedRequirementRevisions).toHaveLength(1);
    expect(result.rejectedRequirements).toHaveLength(0);
  });

  it('15. rejects candidate requirements with leading or trailing whitespace in evidence sourceRevisionId or locator', async () => {
    const record = await repo.captureSourceRevision({
      sourceId: createSourceId('SPEC-001'),
      sourceType: 'sop',
      markdownText: markdownContent
    });

    const validLocator = record.locatorIndex[0].locator;

    // Subcase A: Leading whitespace in sourceRevisionId
    fakeGateway.queueResponse(
      JSON.stringify({
        requirements: [
          {
            requirementKey: 'REQ-WS-1',
            statement: 'Statement 1',
            category: 'business-rule',
            origin: 'EXPLICIT',
            evidence: [{ sourceRevisionId: ` ${record.revision.id}`, locator: validLocator }]
          }
        ],
        findings: []
      })
    );

    const resultA = await useCase.compile({ sourceRevisionIds: [record.revision.id] });
    expect(resultA.acceptedRequirementRevisions).toHaveLength(0);
    expect(resultA.rejectedRequirements).toHaveLength(1);
    expect(resultA.rejectedRequirements[0].requirementKey).toBe('REQ-WS-1');
    expect(resultA.rejectedRequirements[0].error).toBeInstanceOf(UnknownSourceRevisionError);

    // Subcase B: Trailing whitespace in sourceRevisionId
    fakeGateway.queueResponse(
      JSON.stringify({
        requirements: [
          {
            requirementKey: 'REQ-WS-2',
            statement: 'Statement 2',
            category: 'business-rule',
            origin: 'EXPLICIT',
            evidence: [{ sourceRevisionId: `${record.revision.id} `, locator: validLocator }]
          }
        ],
        findings: []
      })
    );

    const resultB = await useCase.compile({ sourceRevisionIds: [record.revision.id] });
    expect(resultB.acceptedRequirementRevisions).toHaveLength(0);
    expect(resultB.rejectedRequirements).toHaveLength(1);
    expect(resultB.rejectedRequirements[0].requirementKey).toBe('REQ-WS-2');
    expect(resultB.rejectedRequirements[0].error).toBeInstanceOf(UnknownSourceRevisionError);

    // Subcase C: Leading whitespace in locator
    fakeGateway.queueResponse(
      JSON.stringify({
        requirements: [
          {
            requirementKey: 'REQ-WS-3',
            statement: 'Statement 3',
            category: 'business-rule',
            origin: 'EXPLICIT',
            evidence: [{ sourceRevisionId: record.revision.id, locator: ` ${validLocator}` }]
          }
        ],
        findings: []
      })
    );

    const resultC = await useCase.compile({ sourceRevisionIds: [record.revision.id] });
    expect(resultC.acceptedRequirementRevisions).toHaveLength(0);
    expect(resultC.rejectedRequirements).toHaveLength(1);
    expect(resultC.rejectedRequirements[0].requirementKey).toBe('REQ-WS-3');
    expect(resultC.rejectedRequirements[0].error).toBeInstanceOf(UnresolvedLocatorError);

    // Subcase D: Trailing whitespace in locator
    fakeGateway.queueResponse(
      JSON.stringify({
        requirements: [
          {
            requirementKey: 'REQ-WS-4',
            statement: 'Statement 4',
            category: 'business-rule',
            origin: 'EXPLICIT',
            evidence: [{ sourceRevisionId: record.revision.id, locator: `${validLocator} ` }]
          }
        ],
        findings: []
      })
    );

    const resultD = await useCase.compile({ sourceRevisionIds: [record.revision.id] });
    expect(resultD.acceptedRequirementRevisions).toHaveLength(0);
    expect(resultD.rejectedRequirements).toHaveLength(1);
    expect(resultD.rejectedRequirements[0].requirementKey).toBe('REQ-WS-4');
    expect(resultD.rejectedRequirements[0].error).toBeInstanceOf(UnresolvedLocatorError);

    // Verify nothing persisted
    expect(await repo.listCandidateFindings()).toHaveLength(0);
  });

  it('16. rejects candidate findings with leading or trailing whitespace in evidence sourceRevisionId or locator', async () => {
    const record = await repo.captureSourceRevision({
      sourceId: createSourceId('SPEC-001'),
      sourceType: 'sop',
      markdownText: markdownContent
    });

    const validLocator = record.locatorIndex[0].locator;

    // Subcase A: Whitespace in finding sourceRevisionId
    fakeGateway.queueResponse(
      JSON.stringify({
        requirements: [],
        findings: [
          {
            findingKey: 'FINDING-WS-1',
            type: 'contradiction',
            relatedRequirementKeys: [],
            evidence: [{ sourceRevisionId: ` ${record.revision.id} `, locator: validLocator }],
            rationale: 'Whitespace in sourceRevisionId'
          }
        ]
      })
    );

    const resultA = await useCase.compile({ sourceRevisionIds: [record.revision.id] });
    expect(resultA.acceptedFindingIds).toHaveLength(0);
    expect(resultA.rejectedFindings).toHaveLength(1);
    expect(resultA.rejectedFindings[0].findingKey).toBe('FINDING-WS-1');
    expect(resultA.rejectedFindings[0].error).toBeInstanceOf(UnknownSourceRevisionError);

    // Subcase B: Whitespace in finding locator
    fakeGateway.queueResponse(
      JSON.stringify({
        requirements: [],
        findings: [
          {
            findingKey: 'FINDING-WS-2',
            type: 'contradiction',
            relatedRequirementKeys: [],
            evidence: [{ sourceRevisionId: record.revision.id, locator: ` ${validLocator} ` }],
            rationale: 'Whitespace in locator'
          }
        ]
      })
    );

    const resultB = await useCase.compile({ sourceRevisionIds: [record.revision.id] });
    expect(resultB.acceptedFindingIds).toHaveLength(0);
    expect(resultB.rejectedFindings).toHaveLength(1);
    expect(resultB.rejectedFindings[0].findingKey).toBe('FINDING-WS-2');
    expect(resultB.rejectedFindings[0].error).toBeInstanceOf(UnresolvedLocatorError);

    expect(await repo.listCandidateFindings()).toHaveLength(0);
  });

  it('17. rejects generation output with duplicate requirementKey or findingKey as MalformedGenerationOutputError', async () => {
    const record = await repo.captureSourceRevision({
      sourceId: createSourceId('SPEC-001'),
      sourceType: 'sop',
      markdownText: markdownContent
    });

    const validLocator = record.locatorIndex[0].locator;

    // Duplicate requirementKey
    fakeGateway.queueResponse(
      JSON.stringify({
        requirements: [
          {
            requirementKey: 'DUP-KEY',
            statement: 'First statement',
            category: 'business-rule',
            origin: 'EXPLICIT',
            evidence: [{ sourceRevisionId: record.revision.id, locator: validLocator }]
          },
          {
            requirementKey: 'DUP-KEY',
            statement: 'Second statement',
            category: 'business-rule',
            origin: 'EXPLICIT',
            evidence: [{ sourceRevisionId: record.revision.id, locator: validLocator }]
          }
        ],
        findings: []
      })
    );

    await expect(useCase.compile({ sourceRevisionIds: [record.revision.id] })).rejects.toThrow(
      MalformedGenerationOutputError
    );
    expect(await repo.listCandidateFindings()).toHaveLength(0);

    // Duplicate findingKey
    fakeGateway.queueResponse(
      JSON.stringify({
        requirements: [],
        findings: [
          {
            findingKey: 'DUP-FINDING-KEY',
            type: 'contradiction',
            relatedRequirementKeys: [],
            evidence: [{ sourceRevisionId: record.revision.id, locator: validLocator }],
            rationale: 'First duplicate finding'
          },
          {
            findingKey: 'DUP-FINDING-KEY',
            type: 'missing-authorization',
            relatedRequirementKeys: [],
            evidence: [{ sourceRevisionId: record.revision.id, locator: validLocator }],
            rationale: 'Second duplicate finding'
          }
        ]
      })
    );

    await expect(useCase.compile({ sourceRevisionIds: [record.revision.id] })).rejects.toThrow(
      MalformedGenerationOutputError
    );
    expect(await repo.listCandidateFindings()).toHaveLength(0);
  });

  it('18. aborts compilation and rethrows operational repository I/O and corruption errors', async () => {
    const record = await repo.captureSourceRevision({
      sourceId: createSourceId('SPEC-001'),
      sourceType: 'sop',
      markdownText: markdownContent
    });

    const validLocator = record.locatorIndex[0].locator;
    const responseJson = JSON.stringify({
      requirements: [
        {
          requirementKey: 'REQ-1',
          statement: 'Inspection statement',
          category: 'business-rule',
          origin: 'EXPLICIT',
          evidence: [{ sourceRevisionId: record.revision.id, locator: validLocator }]
        }
      ],
      findings: []
    });

    // Subcase A: getSourceRevision throws operational I/O error during evidence validation
    const operationalErrorA = new Error('EACCES: permission denied, readJson failed');
    let recordsLoaded = 0;
    const mockRepoA = {
      ...repo,
      getSourceRevision: async (id: any) => {
        if (recordsLoaded === 0) {
          recordsLoaded++;
          return repo.getSourceRevision(id);
        }
        throw operationalErrorA;
      },
      resolveLocator: repo.resolveLocator.bind(repo),
      saveRequirementRevision: repo.saveRequirementRevision.bind(repo),
      saveCandidateFinding: repo.saveCandidateFinding.bind(repo)
    } as unknown as FilesystemRequirementsRepository;

    const useCaseA = new CompileRequirementsUseCase(fakeGateway, mockRepoA);
    fakeGateway.queueResponse(responseJson);

    await expect(useCaseA.compile({ sourceRevisionIds: [record.revision.id] })).rejects.toThrow(
      operationalErrorA
    );

    // Subcase B: resolveLocator throws operational storage error
    const operationalErrorB = new Error('Database/disk I/O failure during locator resolution');
    const mockRepoB = {
      ...repo,
      getSourceRevision: repo.getSourceRevision.bind(repo),
      resolveLocator: async () => {
        throw operationalErrorB;
      },
      saveRequirementRevision: repo.saveRequirementRevision.bind(repo),
      saveCandidateFinding: repo.saveCandidateFinding.bind(repo)
    } as unknown as FilesystemRequirementsRepository;

    const useCaseB = new CompileRequirementsUseCase(fakeGateway, mockRepoB);
    fakeGateway.queueResponse(responseJson);

    await expect(useCaseB.compile({ sourceRevisionIds: [record.revision.id] })).rejects.toThrow(
      operationalErrorB
    );

    // Subcase C: caller-specified source revision loading throws operational corruption error
    const operationalErrorC = new SyntaxError('Unexpected token < in JSON at position 0');
    const mockRepoC = {
      ...repo,
      getSourceRevision: async () => {
        throw operationalErrorC;
      }
    } as unknown as FilesystemRequirementsRepository;

    const useCaseC = new CompileRequirementsUseCase(fakeGateway, mockRepoC);
    await expect(useCaseC.compile({ sourceRevisionIds: [record.revision.id] })).rejects.toThrow(
      operationalErrorC
    );
  });

  it('19. includes prominent sourceType, capturedAt, supersedes, cross-source instructions, precision guidance, and contrastive few-shot examples in generated prompt', async () => {
    const rec1 = await repo.captureSourceRevision({
      sourceId: createSourceId('SRC-POL-001'),
      sourceType: 'policy',
      markdownText: '# Security Policy\n\nAll endpoints must be encrypted.'
    });

    // Capture second revision of SRC-POL-001 with updated text so it sets supersedes
    const rec1v2 = await repo.captureSourceRevision({
      sourceId: createSourceId('SRC-POL-001'),
      sourceType: 'policy',
      markdownText: '# Security Policy\n\nAll endpoints must use hardware-backed encryption.'
    });
    expect(rec1v2.revision.supersedes).toBe(rec1.revision.id);

    const rec2 = await repo.captureSourceRevision({
      sourceId: createSourceId('SRC-INT-001'),
      sourceType: 'interview',
      markdownText: '# Field Interview\n\nEngineers use standard USB drives without encryption.'
    });

    fakeGateway.queueResponse(
      JSON.stringify({
        requirements: [],
        findings: []
      })
    );

    await useCase.compile({
      sourceRevisionIds: [rec1v2.revision.id, rec2.revision.id]
    });

    expect(fakeGateway.recordedRequests).toHaveLength(1);
    const prompt = fakeGateway.recordedRequests[0].prompt;

    // Prominent metadata for each source revision
    expect(prompt).toContain(`### Source Revision: ${rec1v2.revision.id}`);
    expect(prompt).toContain('- Source Type: POLICY');
    expect(prompt).toContain(`- Captured At: ${rec1v2.revision.capturedAt}`);
    expect(prompt).toContain(`- Supersedes: ${rec1.revision.id}`);

    expect(prompt).toContain(`### Source Revision: ${rec2.revision.id}`);
    expect(prompt).toContain('- Source Type: INTERVIEW');
    expect(prompt).toContain(`- Captured At: ${rec2.revision.capturedAt}`);

    // Authority and recency hierarchy instructions
    expect(prompt).toContain('## Source Authority & Recency Hierarchy');
    expect(prompt).toContain('policy');
    expect(prompt).toContain('schema');
    expect(prompt).toContain('sop');
    expect(prompt).toContain('interview');
    expect(prompt).toContain('spreadsheet');

    // Cross-source analysis instructions
    expect(prompt).toContain('## Cross-Source Analysis Instructions');
    expect(prompt).toContain('Topic Overlap');
    expect(prompt).toContain('Contradiction Findings');
    expect(prompt).toContain('Superseded Source Revisions');

    // Evidence standard and precision calibration
    expect(prompt).toContain(
      '## Evidence Standard & Precision Calibration (Preventing False Positives)'
    );
    expect(prompt).toContain('Direct Unambiguous Textual Evidence Required');
    expect(prompt).toContain('Scoped & Partitioned Thresholds Are NOT Contradictions');
    expect(prompt).toContain(
      'Paraphrased & Semantically Equivalent Phrasing Is NOT a Contradiction'
    );

    // Contrastive few-shot examples
    expect(prompt).toContain('## Few-Shot Contrastive Examples');
    expect(prompt).toContain('Source Authority Conflict (Policy vs. Interview)');
    expect(prompt).toContain('Superseded Source Revision');
    expect(prompt).toContain('Distinct Geographically Scoped Thresholds');
    expect(prompt).toContain('Same-Authority Threshold Conflict');
    expect(prompt).toContain('Paraphrased / Semantically Equivalent Timeframes');
  });

  it('does not reproduce any corpus fixture identifiers in few-shot prompt examples (AC-3)', async () => {
    const rec = await repo.captureSourceRevision({
      sourceId: createSourceId('TEST-SRC'),
      sourceType: 'policy',
      markdownText: '# Test Doc\n\nSome requirement text.'
    });

    fakeGateway.queueResponse(
      JSON.stringify({
        requirements: [],
        findings: []
      })
    );

    await useCase.compile({
      sourceRevisionIds: [rec.revision.id]
    });

    expect(fakeGateway.recordedRequests).toHaveLength(1);
    const prompt = fakeGateway.recordedRequests[0].prompt;

    // Fixture identifiers that must NEVER appear in compiler few-shot prompt
    const retiredFixtureIdentifiers = [
      // Example 1 / source-authority-conflict fixture
      'INT-FIELD-001',
      'POL-SEC-001',
      'REQ-INTERVIEW-PRACTICE',
      'REQ-POLICY-RULE',
      'telemetry-retrieval#3.2',
      'removable-media-standards#1.1',
      // Example 2 / superseded-source-revision fixture
      'SOP-DISCOUNT-001',
      'REQ-DISC-CURRENT',
      'discretionary-approval-limits#2.1',
      // Example 3 / false-positive-near-conflict-scoped-thresholds fixture
      'TRAVEL-POL-001',
      'REQ-PERDIEM-DOM',
      'REQ-PERDIEM-INT',
      'meal-reimbursement-tiers#4.1',
      'meal-reimbursement-tiers#4.2',
      // Example 4 / false-positive-near-conflict-paraphrase fixture
      'ONBOARD-DOC-001',
      'SEC-CHECK-001',
      'REQ-MFA-ONBOARD',
      'REQ-MFA-SEC',
      'security-setup#2.2',
      'mfa-compliance#1.3',
      // Approval threshold contradiction fixtures
      'SOP-PROC-001',
      'REQ-APP-01',
      'REQ-APP-02',
      'FINDING-APP-01',
      'procurement-thresholds#2.1',
      'department-sign-off-rules#4.3',
      'FIN-POL-002',
      'OPS-SOP-004',
      'REQ-FIN-01',
      'REQ-OPS-01',
      'FINDING-CROSS-01',
      'executive-approval-limits#3.2',
      'field-equipment-acquisition-workflow#1.5'
    ];

    for (const id of retiredFixtureIdentifiers) {
      expect(prompt).not.toContain(id);
    }
  });
});
