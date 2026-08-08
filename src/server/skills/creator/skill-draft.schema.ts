import { z } from 'zod'
import { capabilityScopeSchema, skillCapabilitySchema, type RequestedCapability } from '../policy/capability-policy'

export const skillDraftCapabilitySchema = z.object({ capability: skillCapabilitySchema, scope: capabilityScopeSchema }).strict()
export const skillDraftContentSchema = z.object({
  // Creator drafts are package-runtime records only. Keeping this as a literal
  // makes the boundary explicit while still normalizing older persisted drafts.
  runtimeKind: z.literal('package').default('package'),
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
  version: z.string().trim().min(1).max(80).default('0.1.0'),
  description: z.string().max(20_000).default(''),
  skillMd: z.string().min(1).max(256 * 1024),
  references: z.record(z.string().min(1).max(256 * 1024)).default({}),
  assets: z.array(z.object({ path: z.string().min(1).max(240), sizeBytes: z.number().int().nonnegative().optional(), mimeType: z.string().max(200).optional() }).strict()).max(10_000).default([]),
  capabilities: z.array(skillDraftCapabilitySchema).max(32).default([]),
  visibility: z.enum(['private', 'workspace', 'public']).default('private'),
  author: z.string().trim().max(200).optional(),
}).strict()

export const createSkillDraftSchema = z.object({
  content: skillDraftContentSchema,
  baseVersionId: z.string().min(1).optional(),
}).strict()

export const updateSkillDraftSchema = z.object({
  expectedRevision: z.number().int().positive(),
  patch: skillDraftContentSchema.partial(),
}).strict()

export const publishSkillDraftSchema = z.object({ enable: z.boolean().default(false) }).strict()

export type SkillDraftContent = z.infer<typeof skillDraftContentSchema>
export type SkillDraftCapability = z.infer<typeof skillDraftCapabilitySchema>
export type SkillDraftValidation = {
  valid: boolean
  errors: Array<{ level: 'error'; code: string; path?: string; message: string }>
  warnings: Array<{ level: 'warning'; code: string; path?: string; message: string }>
  securityFindings: string[]
  previewSummary: { files: string[]; totalBytes: number; capabilityCount: number }
  manifest?: Record<string, unknown>
}
export type SkillDraftRecord = {
  id: string
  ownerId: string
  status: 'draft' | 'published' | 'discarded'
  revision: number
  content: SkillDraftContent
  validation: SkillDraftValidation | null
  baseVersionId: string | null
  publishedVersionId: string | null
  createdAt: number
  updatedAt: number
}

export type { RequestedCapability }
