import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  RecordValidationRunRequestDtoSchema,
  CreateApprovalRequestDtoSchema,
  RevokeApprovalRequestDtoSchema,
  ValidationRunRecordDtoSchema,
  CandidateApprovalRecordDtoSchema,
  CandidatePromotionStatusDtoSchema,
  GovernanceAuditExportDtoSchema
} from '@solutions-studio/contracts';
import { AuthenticationError } from '../../application/ports/identity/IdentityErrors.js';
import type { RecordValidationRunUseCase } from '../../application/use-cases/governance/RecordValidationRunUseCase.js';
import type { ApproveCandidateUseCase } from '../../application/use-cases/governance/ApproveCandidateUseCase.js';
import type { EvaluateCandidatePromotionStatusUseCase } from '../../application/use-cases/governance/EvaluateCandidatePromotionStatusUseCase.js';
import type { RevokeGovernanceApprovalUseCase } from '../../application/use-cases/governance/RevokeGovernanceApprovalUseCase.js';
import type { ExportGovernanceAuditUseCase } from '../../application/use-cases/governance/ExportGovernanceAuditUseCase.js';
import type { IRequirementsRepository } from '../../application/ports/persistence/IRequirementsRepository.js';

export interface GovernanceRoutesOptions {
  readonly recordRunUseCase: RecordValidationRunUseCase;
  readonly approveUseCase: ApproveCandidateUseCase;
  readonly evaluateStatusUseCase: EvaluateCandidatePromotionStatusUseCase;
  readonly revokeUseCase: RevokeGovernanceApprovalUseCase;
  readonly exportUseCase: ExportGovernanceAuditUseCase;
  readonly repository: IRequirementsRepository;
}

const runIdParamsSchema = z.object({
  runId: z.string().min(1)
});

const candidateShaParamsSchema = z.object({
  candidateSha: z.string().min(1)
});

const approvalIdParamsSchema = z.object({
  approvalId: z.string().min(1)
});

const auditExportQuerySchema = z.object({
  candidateSha: z.string().min(1)
});

export const governanceRoutes: FastifyPluginAsync<GovernanceRoutesOptions> = async (
  app,
  options
) => {
  // 0. Get current authoritative candidate SHA
  app.get('/api/governance/current-candidate', async (_request, reply) => {
    let sha = process.env.CANDIDATE_SHA;
    if (!sha) {
      try {
        const cp = await import('node:child_process');
        sha = cp.execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
      } catch {
        // git not available
      }
    }
    if (!sha) {
      const runs = await options.repository.listValidationRuns();
      if (runs.length > 0) {
        sha = runs[0].candidateSha;
      }
    }
    if (!sha) {
      return reply.status(404).send({
        code: 'CANDIDATE_NOT_FOUND',
        message: 'No authoritative current candidate SHA found'
      });
    }
    return reply.status(200).send({ candidateSha: sha });
  });

  // 1. Record validation run
  app.post<{
    Body: z.infer<typeof RecordValidationRunRequestDtoSchema>;
  }>(
    '/api/governance/validation-runs',
    {
      schema: {
        body: RecordValidationRunRequestDtoSchema,
        response: {
          201: ValidationRunRecordDtoSchema
        }
      }
    },
    async (request, reply) => {
      const isAnonymous = !request.actor || Boolean(request.actor.metadata?.isAnonymousFallback);
      const executedBy = isAnonymous || !request.actor ? 'anonymous:runner' : request.actor.id;
      const run = await options.recordRunUseCase.execute({
        candidateSha: request.body.candidateSha,
        phase: request.body.phase,
        executionMode: request.body.executionMode,
        provider: request.body.provider,
        model: request.body.model,
        artifacts: request.body.artifacts,
        proposedDisposition: request.body.proposedDisposition,
        summary: request.body.summary,
        payloadRef: request.body.payloadRef,
        executedBy
      });
      return reply.status(201).send(run);
    }
  );

  // 2. Get validation run by ID
  app.get<{
    Params: z.infer<typeof runIdParamsSchema>;
  }>(
    '/api/governance/validation-runs/:runId',
    {
      schema: {
        params: runIdParamsSchema,
        response: {
          200: ValidationRunRecordDtoSchema
        }
      }
    },
    async (request, reply) => {
      const run = await options.repository.getValidationRun(request.params.runId);
      if (!run) {
        return reply.status(404).send({
          code: 'VALIDATION_RUN_NOT_FOUND',
          message: `Validation run '${request.params.runId}' not found.`
        });
      }
      return reply.status(200).send(run);
    }
  );

  // 3. List validation runs for candidate SHA
  app.get<{
    Params: z.infer<typeof candidateShaParamsSchema>;
  }>(
    '/api/governance/candidates/:candidateSha/validation-runs',
    {
      schema: {
        params: candidateShaParamsSchema,
        response: {
          200: z.array(ValidationRunRecordDtoSchema)
        }
      }
    },
    async (request, reply) => {
      const runs = await options.repository.listValidationRuns({
        candidateSha: request.params.candidateSha
      });
      return reply.status(200).send(runs);
    }
  );

  // 4. Create promotion approval (requires authenticated human actor + candidate:approve capability)
  app.post<{
    Body: z.infer<typeof CreateApprovalRequestDtoSchema>;
  }>(
    '/api/governance/approvals',
    {
      schema: {
        body: CreateApprovalRequestDtoSchema,
        response: {
          201: CandidateApprovalRecordDtoSchema
        }
      }
    },
    async (request, reply) => {
      if (!request.actor || request.actor.metadata?.isAnonymousFallback) {
        throw new AuthenticationError(
          'Explicit authentication required for candidate governance decisions',
          {
            reason: 'AUTHENTICATION_REQUIRED'
          }
        );
      }

      const approval = await options.approveUseCase.execute({
        candidateSha: request.body.candidateSha,
        validationRunId: request.body.validationRunId,
        evidenceDigest: request.body.evidenceDigest,
        decision: request.body.decision,
        rationale: request.body.rationale,
        supersedes: request.body.supersedes,
        actor: request.actor
      });

      return reply.status(201).send(approval);
    }
  );

  // 5. Evaluate candidate promotion readiness status
  app.get<{
    Params: z.infer<typeof candidateShaParamsSchema>;
  }>(
    '/api/governance/candidates/:candidateSha/status',
    {
      schema: {
        params: candidateShaParamsSchema,
        response: {
          200: CandidatePromotionStatusDtoSchema
        }
      }
    },
    async (request, reply) => {
      const status = await options.evaluateStatusUseCase.execute({
        candidateSha: request.params.candidateSha
      });
      return reply.status(200).send(status);
    }
  );

  // 6. List approval history for candidate SHA
  app.get<{
    Params: z.infer<typeof candidateShaParamsSchema>;
  }>(
    '/api/governance/candidates/:candidateSha/approvals',
    {
      schema: {
        params: candidateShaParamsSchema,
        response: {
          200: z.array(CandidateApprovalRecordDtoSchema)
        }
      }
    },
    async (request, reply) => {
      const approvals = await options.repository.listGovernanceApprovals({
        candidateSha: request.params.candidateSha
      });
      return reply.status(200).send(approvals);
    }
  );

  // 7. Revoke approval
  app.post<{
    Params: z.infer<typeof approvalIdParamsSchema>;
    Body: z.infer<typeof RevokeApprovalRequestDtoSchema>;
  }>(
    '/api/governance/approvals/:approvalId/revoke',
    {
      schema: {
        params: approvalIdParamsSchema,
        body: RevokeApprovalRequestDtoSchema,
        response: {
          200: CandidateApprovalRecordDtoSchema
        }
      }
    },
    async (request, reply) => {
      if (!request.actor || request.actor.metadata?.isAnonymousFallback) {
        throw new AuthenticationError(
          'Explicit authentication required for candidate governance decisions',
          {
            reason: 'AUTHENTICATION_REQUIRED'
          }
        );
      }

      const revoked = await options.revokeUseCase.execute({
        approvalId: request.params.approvalId,
        rationale: request.body.rationale,
        actor: request.actor
      });

      return reply.status(200).send(revoked);
    }
  );

  // 8. Export governance audit package
  app.get<{
    Querystring: z.infer<typeof auditExportQuerySchema>;
  }>(
    '/api/governance/audit/export',
    {
      schema: {
        querystring: auditExportQuerySchema,
        response: {
          200: GovernanceAuditExportDtoSchema
        }
      }
    },
    async (request, reply) => {
      const auditPackage = await options.exportUseCase.execute({
        candidateSha: request.query.candidateSha
      });
      return reply.status(200).send(auditPackage);
    }
  );
};
