import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  AcceptRequirementRequestDtoSchema,
  RejectRequirementRequestDtoSchema,
  ReviseRequirementRequestDtoSchema,
  ResolveRequirementRequestDtoSchema
} from '@solutions-studio/contracts';
import { createSourceRevisionId, createEvidenceLocator } from '@solutions-studio/domain';
import type { ReconcileRequirementsUseCase } from '../../application/use-cases/ReconcileRequirementsUseCase.js';
import { mapRequirementRevisionToDto } from '../dto-mappers.js';

export interface RequirementsRoutesOptions {
  readonly reconcileUseCase: ReconcileRequirementsUseCase;
}

const revisionParamsSchema = z.object({
  revisionId: z.string().min(1)
});

export const requirementsRoutes: FastifyPluginAsync<RequirementsRoutesOptions> = async (
  app,
  options
) => {
  app.post<{
    Params: z.infer<typeof revisionParamsSchema>;
    Body: z.infer<typeof AcceptRequirementRequestDtoSchema>;
  }>(
    '/api/requirements/:revisionId/accept',
    {
      schema: {
        params: revisionParamsSchema,
        body: AcceptRequirementRequestDtoSchema
      }
    },
    async (request, reply) => {
      const result = await options.reconcileUseCase.acceptRequirement({
        revisionId: request.params.revisionId,
        ...request.body
      });
      return reply.status(200).send(mapRequirementRevisionToDto(result));
    }
  );

  app.post<{
    Params: z.infer<typeof revisionParamsSchema>;
    Body: z.infer<typeof RejectRequirementRequestDtoSchema>;
  }>(
    '/api/requirements/:revisionId/reject',
    {
      schema: {
        params: revisionParamsSchema,
        body: RejectRequirementRequestDtoSchema
      }
    },
    async (request, reply) => {
      const result = await options.reconcileUseCase.rejectRequirement({
        revisionId: request.params.revisionId,
        ...request.body
      });
      return reply.status(200).send(mapRequirementRevisionToDto(result));
    }
  );

  app.post<{
    Params: z.infer<typeof revisionParamsSchema>;
    Body: z.infer<typeof ReviseRequirementRequestDtoSchema>;
  }>(
    '/api/requirements/:revisionId/revise',
    {
      schema: {
        params: revisionParamsSchema,
        body: ReviseRequirementRequestDtoSchema
      }
    },
    async (request, reply) => {
      const evidence = request.body.evidence?.map((e) => ({
        sourceRevisionId: createSourceRevisionId(e.sourceRevisionId),
        locator: createEvidenceLocator(e.locator)
      }));

      const result = await options.reconcileUseCase.reviseRequirement({
        revisionId: request.params.revisionId,
        ...request.body,
        evidence
      });
      return reply.status(200).send(mapRequirementRevisionToDto(result));
    }
  );

  app.post<{
    Params: z.infer<typeof revisionParamsSchema>;
    Body: z.infer<typeof ResolveRequirementRequestDtoSchema>;
  }>(
    '/api/requirements/:revisionId/resolve',
    {
      schema: {
        params: revisionParamsSchema,
        body: ResolveRequirementRequestDtoSchema
      }
    },
    async (request, reply) => {
      const result = await options.reconcileUseCase.resolveRequirement({
        revisionId: request.params.revisionId,
        ...request.body
      });
      return reply.status(200).send(mapRequirementRevisionToDto(result));
    }
  );
};
