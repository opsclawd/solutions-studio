import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  createRequirementId,
  createRequirementRevisionId,
  createRequirementRevision,
  now
} from '@solutions-studio/domain';
import {
  RequirementsBaselineDtoSchema,
  RequirementsReviewStateDtoSchema,
  ProjectionRecordDtoSchema
} from '@solutions-studio/contracts';
import { FilesystemRequirementsRepository } from '../../src/infrastructure/persistence/filesystem/FilesystemRequirementsRepository.js';
import { FakeGenerationGateway } from '../fakes/FakeGenerationGateway.js';
import { FakeMermaidLinterGateway } from '../fakes/FakeMermaidLinterGateway.js';
import { FakePrototypeValidatorGateway } from '../fakes/FakePrototypeValidatorGateway.js';
import { composeOrchestratorHttpServer } from '../../src/http/composition.js';

describe('Integration: Closed Requirements Discovery Loop (Phase 2.6)', () => {
  let tempDir: string;
  let repo: FilesystemRequirementsRepository;
  let fakeGen: FakeGenerationGateway;
  let fakeLinter: FakeMermaidLinterGateway;
  let fakeValidator: FakePrototypeValidatorGateway;
  let app: FastifyInstance;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'closed-loop-test-'));
    repo = new FilesystemRequirementsRepository({ baseDir: tempDir });
    fakeGen = new FakeGenerationGateway([
      'flowchart TD\n  A[Baseline A Process] --> B[Approval]',
      'flowchart TD\n  A[Baseline B Successor] --> B[Discovered Feature] --> C[Done]'
    ]);
    fakeLinter = new FakeMermaidLinterGateway();
    fakeValidator = new FakePrototypeValidatorGateway();

    const composed = composeOrchestratorHttpServer({
      repository: repo,
      generationGateway: fakeGen,
      linterGateway: fakeLinter,
      prototypeValidatorGateway: fakeValidator
    });
    app = composed.app;
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function seedAuditedRequirement(reqId: string, revId: string, statement: string) {
    const rev = createRequirementRevision({
      id: createRequirementRevisionId(revId),
      requirementId: createRequirementId(reqId),
      revision: 1,
      statement,
      category: 'business-rule',
      origin: 'ASSUMED',
      reviewState: 'ACCEPTED',
      resolutionState: 'CLEAR',
      evidence: []
    });
    await repo.saveRequirementRevision(rev);

    await repo.appendReconciliationRecord({
      id: `rec-${revId}`,
      entityType: 'requirement',
      entityId: createRequirementId(reqId),
      requirementRevisionId: rev.id,
      action: 'ACCEPT',
      previousReviewState: undefined,
      newReviewState: 'ACCEPTED',
      rationale: 'Initial audit completed',
      recordedAt: now()
    });

    return rev;
  }

  it('executes the full closed loop: BASE-001 -> projection -> discovery -> rejection -> reconciliation -> BASE-002 -> projection -> staleness detection & immutability', async () => {
    // ------------------------------------------------------------------------
    // Step 1: Create immutable BASELINE-A (BASE-001) with initial audited requirement
    // ------------------------------------------------------------------------
    const initialRev = await seedAuditedRequirement(
      'REQ-001',
      'REQ-001-R1',
      'Users must authenticate before accessing the dashboard.'
    );

    const createBase1Res = await app.inject({
      method: 'POST',
      url: '/api/baselines',
      payload: {
        id: 'BASE-001',
        requirementRevisions: [initialRev.id],
        createdBy: 'security-architect'
      }
    });
    expect(createBase1Res.statusCode).toBe(200);
    const base1 = RequirementsBaselineDtoSchema.parse(createBase1Res.json());
    expect(base1.id).toBe('BASE-001');
    expect(base1.requirementRevisions).toEqual(['REQ-001-R1']);

    // ------------------------------------------------------------------------
    // Step 2: Generate projection PROJ-001 from BASE-001
    // ------------------------------------------------------------------------
    const proj1Res = await app.inject({
      method: 'POST',
      url: '/api/baselines/BASE-001/projections',
      payload: {
        artifactType: 'process-diagram',
        prompt: 'Generate user auth flow'
      }
    });
    expect(proj1Res.statusCode).toBe(200);
    const proj1 = ProjectionRecordDtoSchema.parse(proj1Res.json());
    expect(proj1.baselineId).toBe('BASE-001');
    expect(proj1.content).toContain('Baseline A Process');

    // ------------------------------------------------------------------------
    // Step 3: SME reviews PROJ-001 and discovers missing behavior
    //         Record candidate discovery requirement (REQ-004-R1) and finding (FIND-001)
    // ------------------------------------------------------------------------
    const discReqRes = await app.inject({
      method: 'POST',
      url: '/api/discoveries/requirements',
      payload: {
        baselineId: 'BASE-001',
        originatingProjectionId: proj1.id,
        statement: 'Two-factor authentication (2FA) must be enforced for admin users.',
        category: 'business-rule',
        proposedBy: 'sme-reviewer',
        rationale: 'Discovered missing MFA step while reviewing process diagram PROJ-001'
      }
    });
    expect(discReqRes.statusCode).toBe(200);
    const discReq = discReqRes.json();
    expect(discReq.id).toMatch(/^REQ-.*-R1$/);
    expect(discReq.revision).toBe(1);
    expect(discReq.reviewState).toBe('PENDING');
    expect(discReq.resolutionState).toBe('UNRESOLVED');
    expect(discReq.originatingProjectionId).toBe(proj1.id);
    expect(discReq.baselineId).toBe('BASE-001');

    const discFindingRes = await app.inject({
      method: 'POST',
      url: '/api/discoveries/findings',
      payload: {
        baselineId: 'BASE-001',
        originatingProjectionId: proj1.id,
        affectedRequirementRevisions: [initialRev.id],
        type: 'missing-authorization',
        rationale: 'Dashboard access without MFA lacks admin authorization check.',
        discoveredBy: 'human',
        actorId: 'sme-reviewer'
      }
    });
    expect(discFindingRes.statusCode).toBe(200);
    const finding = discFindingRes.json();
    expect(finding.id).toBeDefined();
    expect(finding.disposition).toBe('OPEN');
    expect(finding.originatingProjectionId).toBe(proj1.id);

    // ------------------------------------------------------------------------
    // Step 4: Verification — unaccepted proposal cannot be baselined
    //         and open finding blocks baselining affected revision
    // ------------------------------------------------------------------------
    const earlyBaselineProposalRes = await app.inject({
      method: 'POST',
      url: '/api/baselines',
      payload: {
        id: 'BASE-002',
        requirementRevisions: [discReq.id],
        createdBy: 'impatient-reviewer'
      }
    });
    expect(earlyBaselineProposalRes.statusCode).toBe(400);
    expect(earlyBaselineProposalRes.json().code).toBe('INVALID_BASELINE_MEMBERSHIP');

    const earlyBaselineFindingBlockRes = await app.inject({
      method: 'POST',
      url: '/api/baselines',
      payload: {
        id: 'BASE-002',
        requirementRevisions: [initialRev.id],
        createdBy: 'impatient-reviewer'
      }
    });
    expect(earlyBaselineFindingBlockRes.statusCode).toBe(409);
    expect(earlyBaselineFindingBlockRes.json().code).toBe('BLOCKED_BY_OPEN_FINDINGS');

    // ------------------------------------------------------------------------
    // Step 5: Human Reconciliation
    //         - Disposition the finding (RESOLVE)
    //         - Accept the candidate proposal -> creates R2 (ACCEPTED, UNRESOLVED)
    //         - Resolve the candidate proposal -> creates R3 (ACCEPTED, CLEAR)
    // ------------------------------------------------------------------------
    const resolveFindingRes = await app.inject({
      method: 'POST',
      url: `/api/findings/${finding.id}/disposition`,
      payload: {
        disposition: 'RESOLVED',
        rationale: 'Resolved by creating dedicated 2FA requirement',
        actorId: 'security-architect'
      }
    });
    expect(resolveFindingRes.statusCode).toBe(200);
    expect(resolveFindingRes.json().disposition).toBe('RESOLVED');

    const acceptReqRes = await app.inject({
      method: 'POST',
      url: `/api/requirements/${discReq.id}/accept`,
      payload: {
        rationale: 'Accepted into scope after SME review',
        actorId: 'security-architect'
      }
    });
    expect(acceptReqRes.statusCode).toBe(200);
    const acceptedR2 = acceptReqRes.json();
    expect(acceptedR2.id).toBe(`${discReq.requirementId}-R2`);
    expect(acceptedR2.revision).toBe(2);
    expect(acceptedR2.reviewState).toBe('ACCEPTED');
    expect(acceptedR2.resolutionState).toBe('UNRESOLVED');

    const resolveReqRes = await app.inject({
      method: 'POST',
      url: `/api/requirements/${acceptedR2.id}/resolve`,
      payload: {
        rationale: 'Dependencies and scope clear',
        actorId: 'security-architect'
      }
    });
    expect(resolveReqRes.statusCode).toBe(200);
    const resolvedR3 = resolveReqRes.json();
    expect(resolvedR3.id).toBe(`${discReq.requirementId}-R3`);
    expect(resolvedR3.revision).toBe(3);
    expect(resolvedR3.reviewState).toBe('ACCEPTED');
    expect(resolvedR3.resolutionState).toBe('CLEAR');

    // Verify review state for BASE-001 hydrates candidate discovery to latest revision R3
    const base1ReviewStateRes = await app.inject({
      method: 'GET',
      url: '/api/requirements/review-state?baselineId=BASE-001'
    });
    expect(base1ReviewStateRes.statusCode).toBe(200);
    const base1ReviewState = RequirementsReviewStateDtoSchema.parse(base1ReviewStateRes.json());
    const discoveredMember = base1ReviewState.requirementRevisions.find(
      (r) => r.requirementId === discReq.requirementId
    );
    expect(discoveredMember).toBeDefined();
    expect(discoveredMember?.id).toBe(resolvedR3.id);
    expect(discoveredMember?.revision).toBe(3);
    expect(discoveredMember?.reviewState).toBe('ACCEPTED');
    expect(discoveredMember?.resolutionState).toBe('CLEAR');

    // ------------------------------------------------------------------------
    // Step 6: Create successor baseline BASELINE-B (BASE-002) with reconciled revisions
    // ------------------------------------------------------------------------
    const createBase2Res = await app.inject({
      method: 'POST',
      url: '/api/baselines',
      payload: {
        id: 'BASE-002',
        requirementRevisions: ['REQ-001-R1', resolvedR3.id],
        createdBy: 'security-architect'
      }
    });
    expect(createBase2Res.statusCode).toBe(200);
    const base2 = RequirementsBaselineDtoSchema.parse(createBase2Res.json());
    expect(base2.id).toBe('BASE-002');
    expect(base2.requirementRevisions).toEqual(['REQ-001-R1', resolvedR3.id]);

    // ------------------------------------------------------------------------
    // Step 7: Regenerate projections from BASE-002 (PROJ-002)
    // ------------------------------------------------------------------------
    const proj2Res = await app.inject({
      method: 'POST',
      url: '/api/baselines/BASE-002/projections',
      payload: {
        artifactType: 'process-diagram',
        prompt: 'Generate updated auth flow with 2FA'
      }
    });
    expect(proj2Res.statusCode).toBe(200);
    const proj2 = ProjectionRecordDtoSchema.parse(proj2Res.json());
    expect(proj2.baselineId).toBe('BASE-002');
    expect(proj2.content).toContain('Baseline B Successor');

    // ------------------------------------------------------------------------
    // Step 8: Verify Review State for BASE-002 includes:
    //         - Active baseline BASE-002
    //         - Available baselines: BASE-001 and BASE-002
    //         - All workspace projections (PROJ-001 and PROJ-002)
    //         - Identity comparison confirms PROJ-001 is stale relative to BASE-002
    // ------------------------------------------------------------------------
    const base2ReviewStateRes = await app.inject({
      method: 'GET',
      url: '/api/requirements/review-state?baselineId=BASE-002'
    });
    expect(base2ReviewStateRes.statusCode).toBe(200);
    const base2ReviewState = RequirementsReviewStateDtoSchema.parse(base2ReviewStateRes.json());

    expect(base2ReviewState.baseline?.id).toBe('BASE-002');
    expect(base2ReviewState.availableBaselines).toEqual(['BASE-001', 'BASE-002']);

    const workspaceProjs = base2ReviewState.projections;
    expect(workspaceProjs.length).toBe(2);

    const oldProj = workspaceProjs.find((p) => p.id === proj1.id);
    const newProj = workspaceProjs.find((p) => p.id === proj2.id);
    expect(oldProj).toBeDefined();
    expect(newProj).toBeDefined();

    // Staleness identity check
    expect(oldProj?.baselineId !== base2ReviewState.baseline?.id).toBe(true);
    expect(newProj?.baselineId === base2ReviewState.baseline?.id).toBe(true);

    // ------------------------------------------------------------------------
    // Step 9: Verify Historical Immutability
    //         - BASE-001 remains completely unchanged on disk and API
    //         - BASE-001 projections endpoint returns ONLY PROJ-001, never PROJ-002
    //         - BASE-002 projections endpoint returns ONLY PROJ-002, never PROJ-001
    //         - Attempting to overwrite existing BASE-001 fails
    // ------------------------------------------------------------------------
    const fetchBase1Res = await app.inject({
      method: 'GET',
      url: '/api/baselines/BASE-001'
    });
    expect(fetchBase1Res.statusCode).toBe(200);
    const fetchedBase1 = RequirementsBaselineDtoSchema.parse(fetchBase1Res.json());
    expect(fetchedBase1.requirementRevisions).toEqual(['REQ-001-R1']);
    expect(fetchedBase1.requirementRevisions).not.toContain('REQ-002-R3');

    // Baseline-scoped projections endpoints strictly isolate
    const base1ProjectionsRes = await app.inject({
      method: 'GET',
      url: '/api/baselines/BASE-001/projections'
    });
    expect(base1ProjectionsRes.statusCode).toBe(200);
    const base1Projections = base1ProjectionsRes.json();
    expect(base1Projections.length).toBe(1);
    expect(base1Projections[0].id).toBe(proj1.id);
    expect(base1Projections[0].baselineId).toBe('BASE-001');

    const base2ProjectionsRes = await app.inject({
      method: 'GET',
      url: '/api/baselines/BASE-002/projections'
    });
    expect(base2ProjectionsRes.statusCode).toBe(200);
    const base2Projections = base2ProjectionsRes.json();
    expect(base2Projections.length).toBe(1);
    expect(base2Projections[0].id).toBe(proj2.id);
    expect(base2Projections[0].baselineId).toBe('BASE-002');

    // Exclusive write protection prevents overwriting BASE-001
    const duplicateBase1Res = await app.inject({
      method: 'POST',
      url: '/api/baselines',
      payload: {
        id: 'BASE-001',
        requirementRevisions: ['REQ-001-R1'],
        createdBy: 'malicious-overwrite'
      }
    });
    expect(duplicateBase1Res.statusCode).toBe(409);

    // Baseline enumeration lists both baselines in chronological order
    const listBaselinesRes = await app.inject({
      method: 'GET',
      url: '/api/baselines'
    });
    expect(listBaselinesRes.statusCode).toBe(200);
    const baselinesList = listBaselinesRes.json();
    expect(baselinesList.map((b: { id: string }) => b.id)).toEqual(['BASE-001', 'BASE-002']);
  });
});
