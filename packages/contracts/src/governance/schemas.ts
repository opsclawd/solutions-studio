import { z } from 'zod';
import {
  GOVERNANCE_DECISIONS,
  PROMOTION_DISPOSITIONS,
  PROMOTION_DIAGNOSTIC_CODES
} from '@solutions-studio/domain';
import { InstantDtoSchema } from '../requirements/schemas.js';

export const ValidationArtifactDtoSchema = z.object({
  name: z.string().trim().min(1),
  artifactType: z.string().trim().min(1),
  contentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, 'Must be a 64-character hexadecimal SHA-256 hash'),
  payloadRef: z.string().optional(),
  content: z.string().optional()
});

export const ValidationRunRecordDtoSchema = z.object({
  id: z.string().min(1),
  candidateSha: z
    .string()
    .regex(/^[a-f0-9]{7,64}$/i, 'Candidate SHA must be a valid git commit hash'),
  executedAt: InstantDtoSchema,
  executedBy: z.string().min(1),
  phase: z.string().min(1),
  executionMode: z.enum(['deterministic-ci', 'real-provider']),
  provider: z.string().min(1),
  model: z.string().optional(),
  artifacts: z
    .array(ValidationArtifactDtoSchema)
    .min(1, 'Validation run must contain at least one validation artifact'),
  evidenceDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, 'Evidence digest must be a 64-character SHA-256 hash'),
  proposedDisposition: z.enum(GOVERNANCE_DECISIONS).optional(),
  summary: z.record(z.unknown()),
  payloadRef: z.string().optional()
});

export const ApprovalActorDtoSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  email: z.string().email().optional(),
  actorType: z.literal('human')
});

export const ApprovalRevocationDtoSchema = z.object({
  revokedAt: InstantDtoSchema,
  revokedBy: ApprovalActorDtoSchema,
  rationale: z.string().trim().min(1, 'Revocation rationale must not be empty')
});

const BaseCandidateApprovalSchema = z.object({
  id: z.string().min(1),
  candidateSha: z
    .string()
    .regex(/^[a-f0-9]{7,64}$/i, 'Candidate SHA must be a valid git commit hash'),
  validationRunId: z.string().min(1),
  evidenceDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, 'Evidence digest must be a 64-character SHA-256 hash'),
  decision: z.enum(GOVERNANCE_DECISIONS),
  actor: ApprovalActorDtoSchema,
  decidedAt: InstantDtoSchema,
  rationale: z.string().trim().min(1, 'Approval rationale must not be empty'),
  supersedes: z.string().min(1).optional()
});

export const CandidateApprovalRecordDtoSchema = z.discriminatedUnion('status', [
  BaseCandidateApprovalSchema.extend({
    status: z.literal('ACTIVE'),
    revocation: z.undefined().optional()
  }),
  BaseCandidateApprovalSchema.extend({
    status: z.literal('SUPERSEDED'),
    revocation: z.undefined().optional()
  }),
  BaseCandidateApprovalSchema.extend({
    status: z.literal('REVOKED'),
    revocation: ApprovalRevocationDtoSchema
  })
]);

export const CreateApprovalRequestDtoSchema = z.object({
  candidateSha: z
    .string()
    .regex(/^[a-f0-9]{7,64}$/i, 'Candidate SHA must be a valid git commit hash'),
  validationRunId: z.string().min(1),
  evidenceDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, 'Evidence digest must be a 64-character SHA-256 hash'),
  decision: z.enum(GOVERNANCE_DECISIONS),
  rationale: z.string().trim().min(1, 'Approval rationale is required'),
  supersedes: z.string().min(1).optional()
});

export const RevokeApprovalRequestDtoSchema = z.object({
  rationale: z.string().trim().min(1, 'Revocation rationale is required')
});

export const ValidationArtifactInputDtoSchema = z
  .object({
    name: z.string().trim().min(1),
    artifactType: z.string().trim().min(1),
    contentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/i, 'Must be a 64-character hexadecimal SHA-256 hash')
      .optional(),
    content: z.string().optional(),
    payloadRef: z.string().optional()
  })
  .refine((data) => Boolean(data.contentHash || data.content !== undefined), {
    message: 'Either contentHash or content must be provided for a validation artifact'
  });

export const RecordValidationRunRequestDtoSchema = z.object({
  candidateSha: z
    .string()
    .regex(/^[a-f0-9]{7,64}$/i, 'Candidate SHA must be a valid git commit hash'),
  phase: z.string().min(1),
  executionMode: z.enum(['deterministic-ci', 'real-provider']),
  provider: z.string().min(1),
  model: z.string().optional(),
  artifacts: z
    .array(ValidationArtifactInputDtoSchema)
    .min(1, 'Validation run must contain at least one validation artifact'),
  proposedDisposition: z.enum(GOVERNANCE_DECISIONS).optional(),
  summary: z.record(z.unknown()).optional(),
  payloadRef: z.string().optional()
});

export const CandidatePromotionStatusDtoSchema = z.object({
  candidateSha: z.string(),
  isApproved: z.boolean(),
  disposition: z.enum(PROMOTION_DISPOSITIONS),
  diagnosticCode: z.enum(PROMOTION_DIAGNOSTIC_CODES),
  message: z.string(),
  validationRun: ValidationRunRecordDtoSchema.optional(),
  activeApproval: CandidateApprovalRecordDtoSchema.optional(),
  evaluatedAt: InstantDtoSchema
});

export const ArtifactVerificationResultDtoSchema = z.object({
  name: z.string().min(1),
  artifactType: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  payloadRef: z.string().optional(),
  verified: z.boolean(),
  recomputedHash: z.string().regex(/^[a-f0-9]{64}$/i),
  content: z.string().optional()
});

export const GovernanceAuditExportDtoSchema = z.object({
  exportedAt: InstantDtoSchema,
  candidateSha: z.string(),
  promotionStatus: CandidatePromotionStatusDtoSchema,
  validationRuns: z.array(ValidationRunRecordDtoSchema),
  approvalHistory: z.array(CandidateApprovalRecordDtoSchema),
  verifiedArtifacts: z.array(ArtifactVerificationResultDtoSchema).optional(),
  manifestChecksum: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, 'Manifest checksum must be a 64-character SHA-256 hash')
});
