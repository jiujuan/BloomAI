import { z } from 'zod'
import { MIGRATION_SKILL_TYPES } from './migration.types'

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(),
  z.array(jsonValueSchema).max(2_000),
  z.record(jsonValueSchema),
]))

export const legacySkillSourceInputSchema = z.object({
  legacySkillId: z.string().trim().min(1).max(200).optional(),
  id: z.string().trim().min(1).max(200).optional(),
  type: z.unknown().optional(),
  kind: z.unknown().optional(),
  name: z.unknown().optional(),
  description: z.unknown().optional(),
  version: z.unknown().optional(),
  source: z.unknown().optional(),
  paramsSchema: z.unknown().optional(),
  params_schema: z.unknown().optional(),
  inputSchema: z.unknown().optional(),
  outputSchema: z.unknown().optional(),
  metadata: z.unknown().optional(),
}).strip()

export const normalizedLegacySourceSchema = z.object({
  legacySkillId: z.string().min(1).max(200),
  type: z.enum([...MIGRATION_SKILL_TYPES, 'unknown'] as [string, ...string[]]),
  name: z.string().min(1).max(200),
  description: z.string().max(20_000),
  version: z.string().min(1).max(80),
  source: jsonValueSchema,
  inputSchema: jsonValueSchema,
  outputSchema: jsonValueSchema,
  metadata: z.record(jsonValueSchema),
  canonicalJson: z.string().min(2),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

export const classifiedMigrationSchema = z.object({
  type: z.enum([...MIGRATION_SKILL_TYPES, 'unknown'] as [string, ...string[]]),
  decision: z.enum(['auto_convertible', 'manual_review', 'critical_blocked', 'unsupported']),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
  reasons: z.array(z.string().min(1)),
  acceptedFields: z.array(z.string().min(1)),
}).strict()

const draftContentSchema = z.object({
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  version: z.string().min(1),
  description: z.string(),
  skillMd: z.string().min(1),
  references: z.record(z.string()),
  assets: z.array(z.object({ path: z.string(), content: z.string() }).strict()),
  capabilities: z.array(z.object({ capability: z.string(), scope: z.record(jsonValueSchema) }).strict()),
  visibility: z.literal('private'),
  author: z.string().optional(),
}).strict()

export const draftCandidateSchema = z.object({
  kind: z.literal('package-draft-candidate'),
  schemaVersion: z.literal(1),
  legacySkillId: z.string().min(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  manifest: z.object({
    schemaVersion: z.literal(1),
    name: z.string().min(1),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    version: z.string().min(1),
    description: z.string(),
    entryPath: z.literal('SKILL.md'),
    runtime: z.literal('instruction-agent'),
    capabilities: z.array(z.never()),
    files: z.array(z.literal('SKILL.md')),
    compatibility: z.object({ legacySkillId: z.string(), sourceType: z.string() }).strict(),
    unsupported: z.array(z.string()),
    extensions: z.record(jsonValueSchema),
  }).strict(),
  content: draftContentSchema,
  inputSchema: jsonValueSchema,
  outputSchema: jsonValueSchema,
  templateVariables: z.array(z.string()),
  warnings: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
  decision: z.enum(['auto_convertible', 'critical_blocked']),
  sideEffects: z.object({ network: z.literal(false), model: z.literal(false), runner: z.literal(false), database: z.literal(false), queue: z.literal(false), publish: z.literal(false) }).strict(),
}).strict()

export const httpManualReviewReportSchema = z.object({
  kind: z.literal('manual-review-report'),
  sourceType: z.literal('http-api'),
  legacySkillId: z.string().min(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  lifecycle: z.literal('manual_review_required'),
  decision: z.literal('manual_review'),
  riskLevel: z.enum(['medium', 'high', 'critical']),
  request: z.object({
    url: z.string(),
    method: z.string(),
    headerNames: z.array(z.string()),
    queryKeys: z.array(z.string()),
    bodyShape: jsonValueSchema,
  }).strict(),
  auth: z.object({ present: z.boolean(), type: z.string().optional() }).strict(),
  urlRisks: z.array(z.object({ code: z.string(), severity: z.enum(['high', 'critical']), message: z.string() }).strict()),
  requiredCapabilities: z.array(z.string()),
  manualActions: z.array(z.string()),
  redaction: z.object({ redactedCount: z.number().int().nonnegative() }).strict(),
  sideEffects: z.object({ network: z.literal(false), database: z.literal(false), queue: z.literal(false), runner: z.literal(false), publish: z.literal(false) }).strict(),
}).strict()

export const criticalBlockedReportSchema = z.object({
  kind: z.literal('critical-blocked-report'),
  sourceType: z.literal('js-function'),
  legacySkillId: z.string().min(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  lifecycle: z.literal('migration_blocked'),
  decision: z.literal('critical_blocked'),
  riskLevel: z.literal('critical'),
  blockers: z.array(z.string()),
  rewriteGuidance: z.array(z.string()),
  sideEffects: z.object({ execution: z.literal(false), vm: z.literal(false), eval: z.literal(false), functionConstructor: z.literal(false), childProcess: z.literal(false), dynamicImport: z.literal(false), network: z.literal(false), database: z.literal(false) }).strict(),
}).strict()

export const unsupportedReportSchema = z.object({
  kind: z.literal('unsupported-report'),
  sourceType: z.literal('unknown'),
  legacySkillId: z.string().min(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  lifecycle: z.literal('migration_blocked'),
  decision: z.literal('unsupported'),
  riskLevel: z.literal('critical'),
  blockers: z.array(z.string()),
  sideEffects: z.object({ network: z.literal(false), database: z.literal(false), queue: z.literal(false), runner: z.literal(false), publish: z.literal(false) }).strict(),
}).strict()

export const migrationPreviewSchema = z.object({
  legacySkillId: z.string().min(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  classification: classifiedMigrationSchema,
  lifecycle: z.enum(['migration_previewed', 'manual_review_required', 'migration_blocked']),
  result: z.union([draftCandidateSchema, httpManualReviewReportSchema, criticalBlockedReportSchema, unsupportedReportSchema]),
  readOnly: z.literal(true),
  idempotencyKey: z.string().min(1),
}).strict()

export type MigrationInputSchema = z.infer<typeof legacySkillSourceInputSchema>
