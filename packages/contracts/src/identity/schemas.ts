import { z } from 'zod';
import { APPLICATION_CAPABILITIES, ACTOR_TYPES } from '@solutions-studio/domain';

export const ApplicationCapabilitySchema = z.enum(APPLICATION_CAPABILITIES);
export const ActorTypeSchema = z.enum(ACTOR_TYPES);

export const AuthenticatedActorDtoSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.string().optional(),
  actorType: ActorTypeSchema,
  capabilities: z.array(ApplicationCapabilitySchema)
});

export type ApplicationCapabilityDto = z.infer<typeof ApplicationCapabilitySchema>;
export type ApplicationCapability = ApplicationCapabilityDto;
export type ActorTypeDto = z.infer<typeof ActorTypeSchema>;
export type ActorType = ActorTypeDto;
export type AuthenticatedActorDto = z.infer<typeof AuthenticatedActorDtoSchema>;
