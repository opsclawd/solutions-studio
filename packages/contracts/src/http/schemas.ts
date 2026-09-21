import { z } from 'zod';

export const HealthDependencyStatusSchema = z.enum([
  'healthy',
  'unhealthy',
  'degraded',
  'unconfigured'
]);
export type HealthDependencyStatus = z.infer<typeof HealthDependencyStatusSchema>;

export const StorageDependencyHealthSchema = z.object({
  status: HealthDependencyStatusSchema,
  latencyMs: z.number().optional(),
  message: z.string().optional(),
  details: z.record(z.unknown()).optional(),
  dialect: z.string().optional(),
  currentMigration: z.number().optional(),
  error: z.string().optional()
});
export type StorageDependencyHealthDto = z.infer<typeof StorageDependencyHealthSchema>;

export const ObjectStoreDependencyHealthSchema = z.object({
  status: HealthDependencyStatusSchema,
  latencyMs: z.number().optional(),
  message: z.string().optional(),
  details: z.record(z.unknown()).optional(),
  backend: z.string().optional(),
  error: z.string().optional()
});
export type ObjectStoreDependencyHealthDto = z.infer<typeof ObjectStoreDependencyHealthSchema>;

export const IdentityDependencyHealthSchema = z.object({
  status: HealthDependencyStatusSchema,
  provider: z.string(),
  issuer: z.string().optional(),
  reachable: z.boolean(),
  latencyMs: z.number().optional(),
  error: z.string().optional()
});
export type IdentityDependencyHealthDto = z.infer<typeof IdentityDependencyHealthSchema>;

export const GenerationDependencyHealthSchema = z.object({
  status: HealthDependencyStatusSchema,
  provider: z.string(),
  available: z.boolean(),
  error: z.string().optional()
});
export type GenerationDependencyHealthDto = z.infer<typeof GenerationDependencyHealthSchema>;

export const BacklogDependencyHealthSchema = z.object({
  status: HealthDependencyStatusSchema,
  provider: z.string().optional(),
  reachable: z.boolean().optional(),
  error: z.string().optional()
});
export type BacklogDependencyHealthDto = z.infer<typeof BacklogDependencyHealthSchema>;

export const HealthCheckResponseSchema = z.object({
  status: z.enum(['healthy', 'unhealthy', 'degraded', 'ok']),
  timestamp: z.string(),
  uptime: z.number().nonnegative().optional(),
  version: z.string().optional(),
  database: StorageDependencyHealthSchema.optional(),
  objectStore: ObjectStoreDependencyHealthSchema.optional(),
  identity: IdentityDependencyHealthSchema.optional(),
  generation: GenerationDependencyHealthSchema.optional(),
  backlog: BacklogDependencyHealthSchema.optional(),
  dependencies: z
    .object({
      database: StorageDependencyHealthSchema.optional(),
      objectStore: ObjectStoreDependencyHealthSchema.optional(),
      identity: IdentityDependencyHealthSchema.optional(),
      generation: GenerationDependencyHealthSchema.optional(),
      backlog: BacklogDependencyHealthSchema.optional()
    })
    .optional()
});
export type HealthCheckResponseDto = z.infer<typeof HealthCheckResponseSchema>;

export const TelemetrySummaryResponseSchema = z.object({
  timestamp: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  metrics: z.record(z.unknown())
});
export type TelemetrySummaryResponseDto = z.infer<typeof TelemetrySummaryResponseSchema>;

export const MaintenanceRetentionRequestSchema = z.object({
  maxRawFixtureAgeDays: z.number().int().positive().optional(),
  maxSummaryAgeDays: z.number().int().positive().optional(),
  keepLast: z.number().int().positive().optional(),
  pruneTransientProjections: z.boolean().optional(),
  dryRun: z.boolean().optional()
});
export type MaintenanceRetentionRequestDto = z.infer<typeof MaintenanceRetentionRequestSchema>;

export const MaintenanceRetentionResponseSchema = z.object({
  status: z.enum(['completed', 'dry-run', 'failed']),
  timestamp: z.string(),
  dryRun: z.boolean(),
  prunedFixturesCount: z.number(),
  prunedSummariesCount: z.number(),
  retainedSummariesCount: z.number(),
  prunedProjectionsCount: z.number().optional(),
  durationMs: z.number().optional(),
  error: z.string().optional()
});
export type MaintenanceRetentionResponseDto = z.infer<typeof MaintenanceRetentionResponseSchema>;
