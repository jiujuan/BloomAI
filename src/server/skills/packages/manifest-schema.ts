import { z } from 'zod'
import { capabilityScopeSchema, skillCapabilitySchema, type RequestedCapability } from '../policy/capability-policy'

export const MANIFEST_SCHEMA_VERSION = 1

const manifestAuthorSchema = z.string().trim().min(1).max(200).optional()
const manifestFilePathSchema = z.string().min(1).max(240).refine((value) => {
  const normalized = value.replace(/\\/g, '/')
  return !normalized.startsWith('/') && !/^[A-Za-z]:\//.test(normalized) && !normalized.split('/').some((part) => part === '..' || part === '' || part === '.') && !normalized.includes('\0')
}, 'must be a safe relative package path')
const requestedCapabilitySchema = z.object({ capability: skillCapabilitySchema, scope: capabilityScopeSchema }).strict()

export const canonicalManifestSchema = z.object({
  schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
  name: z.string().trim().min(1).max(200),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
  version: z.string().trim().min(1).max(80),
  description: z.string().max(20_000),
  license: z.string().trim().min(1).max(200).optional(),
  author: manifestAuthorSchema,
  entryPath: manifestFilePathSchema,
  runtime: z.literal('instruction-agent'),
  capabilities: z.array(requestedCapabilitySchema).max(32),
  files: z.array(manifestFilePathSchema).max(10_000),
  compatibility: z.record(z.unknown()),
  unsupported: z.array(z.string().trim().min(1).max(200)).max(128),
  extensions: z.record(z.unknown()),
}).strict()

export type CanonicalSkillManifest = z.infer<typeof canonicalManifestSchema>
export type ManifestDiagnostic = {
  level: 'error' | 'warning'
  code: string
  path?: string
  message: string
}
export type ManifestValidationResult = {
  valid: boolean
  errors: ManifestDiagnostic[]
  warnings: ManifestDiagnostic[]
  manifest?: CanonicalSkillManifest
}

export function toRequestedCapabilities(value: unknown): RequestedCapability[] {
  const parsed = z.array(requestedCapabilitySchema).safeParse(value)
  return parsed.success ? parsed.data : []
}
