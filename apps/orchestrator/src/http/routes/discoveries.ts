import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import {
  RecordRequirementDiscoveryRequestDtoSchema,
  RecordFindingDiscoveryRequestDtoSchema,
  type RecordRequirementDiscoveryRequestDto,
  type RecordFindingDiscoveryRequestDto
} from '@solutions-studio/contracts';
import type { RecordRequirementsDiscoveryUseCase } from '../../application/use-cases/RecordRequirementsDiscoveryUseCase.js';
import type { IAuthorizationPolicy } from '../../application/ports/identity/IAuthorizationPolicy.js';
import { AuthenticationError } from '../../application/ports/identity/IdentityErrors.js';
import { mapRequirementRevisionToDto, mapCandidateFindingToDto } from '../dto-mappers.js';

export interface DiscoveriesRoutesOptions {
  readonly recordDiscoveryUseCase: RecordRequirementsDiscoveryUseCase;
  readonly authorizer?: IAuthorizationPolicy;
}

export const discoveriesRoutes: FastifyPluginAsync<DiscoveriesRoutesOptions> = async (
  app,
  options
) => {
  const handleRequirementDiscovery = async (
    request: FastifyRequest<{ Body: RecordRequirementDiscoveryRequestDto }>,
    reply: FastifyReply
  ) => {
    if (options.authorizer) {
      if (!request.actor) {
        throw new AuthenticationError('Unauthenticated request', { reason: 'NO_ACTOR' });
      }
      options.authorizer.authorize(request.actor, 'requirements:reconcile');
    }

    const actorId = request.actor?.id ?? request.body.actorId;
    const result = await options.recordDiscoveryUseCase.recordRequirementDiscovery({
      ...request.body,
      actorId
    });
    return reply.status(200).send(mapRequirementRevisionToDto(result));
  };

  const handleFindingDiscovery = async (
    request: FastifyRequest<{ Body: RecordFindingDiscoveryRequestDto }>,
    reply: FastifyReply
  ) => {
    if (options.authorizer) {
      if (!request.actor) {
        throw new AuthenticationError('Unauthenticated request', { reason: 'NO_ACTOR' });
      }
      options.authorizer.authorize(request.actor, 'candidate:approve');
    }

    const actorId = request.actor?.id ?? request.body.actorId;
    const result = await options.recordDiscoveryUseCase.recordFindingDiscovery({
      ...request.body,
      actorId
    });
    return reply.status(200).send(mapCandidateFindingToDto(result));
  };

  app.post(
    '/api/requirements/discoveries',
    {
      schema: {
        body: RecordRequirementDiscoveryRequestDtoSchema
      }
    },
    handleRequirementDiscovery
  );

  app.post(
    '/api/discoveries/requirements',
    {
      schema: {
        body: RecordRequirementDiscoveryRequestDtoSchema
      }
    },
    handleRequirementDiscovery
  );

  app.post(
    '/api/findings/discoveries',
    {
      schema: {
        body: RecordFindingDiscoveryRequestDtoSchema
      }
    },
    handleFindingDiscovery
  );

  app.post(
    '/api/discoveries/findings',
    {
      schema: {
        body: RecordFindingDiscoveryRequestDtoSchema
      }
    },
    handleFindingDiscovery
  );
};
