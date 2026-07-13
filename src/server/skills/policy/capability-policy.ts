import path from 'path'
import { z } from 'zod'

export const skillCapabilitySchema = z.enum([
  'web.search',
  'web.fetch',
  'document.read_uploaded',
  'package.read',
  'artifact.write',
  'image.generate',
])

export type SkillCapability = z.infer<typeof skillCapabilitySchema>

export const capabilityGrantModeSchema = z.enum(['once', 'session', 'persistent'])
export type CapabilityGrantMode = z.infer<typeof capabilityGrantModeSchema>

const capabilityScopeSchema = z.object({
  allowedRoots: z.array(z.string().min(1)).min(1).optional(),
  allowedDomains: z.array(z.string().min(1)).min(1).optional(),
  allowedModels: z.array(z.string().min(1)).min(1).optional(),
  maxCalls: z.number().int().positive().optional(),
}).strict()

export type CapabilityScope = {
  allowedRoots?: readonly string[]
  allowedDomains?: readonly string[]
  allowedModels?: readonly string[]
  maxCalls?: number
}

export const capabilityGrantRequestSchema = z.object({
  capability: skillCapabilitySchema,
  grantMode: capabilityGrantModeSchema,
  scope: capabilityScopeSchema.default({}),
  sessionId: z.string().min(1).optional(),
  grantedBy: z.string().min(1).optional(),
  expiresAt: z.number().int().positive().optional(),
}).superRefine((grant, ctx) => {
  if (grant.grantMode === 'session' && !grant.sessionId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sessionId'], message: 'sessionId is required for a session grant' })
  }
})

export type CapabilityGrantRequest = z.infer<typeof capabilityGrantRequestSchema>

export type CapabilityScopeCheck = {
  capability: SkillCapability
  input: Record<string, unknown>
  scope: CapabilityScope
}

export function isScopeAllowed(check: CapabilityScopeCheck): { allowed: true } | { allowed: false; reason: string } {
  if (check.capability === 'web.fetch' || check.capability === 'web.search') {
    if (!check.scope.allowedDomains) return { allowed: true }
    const rawUrl = typeof check.input.url === 'string' ? check.input.url : undefined
    if (!rawUrl) return { allowed: false, reason: 'A URL is required for this scoped capability' }
    try {
      const hostname = new URL(rawUrl).hostname.toLowerCase()
      return check.scope.allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
        ? { allowed: true }
        : { allowed: false, reason: `Domain is not allowed: ${hostname}` }
    } catch {
      return { allowed: false, reason: 'URL must be valid' }
    }
  }

  if (check.capability === 'document.read_uploaded' || check.capability === 'package.read') {
    if (!check.scope.allowedRoots) return { allowed: true }
    const rawPath = typeof check.input.path === 'string' ? check.input.path : undefined
    if (!rawPath) return { allowed: false, reason: 'A path is required for this scoped capability' }
    const resolvedPath = path.resolve(rawPath)
    return check.scope.allowedRoots.some((root) => {
      const resolvedRoot = path.resolve(root)
      return resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)
    })
      ? { allowed: true }
      : { allowed: false, reason: 'Path is outside the granted roots' }
  }

  if (check.capability === 'image.generate') {
    const model = typeof check.input.model === 'string' ? check.input.model : undefined
    if (check.scope.allowedModels && (!model || !check.scope.allowedModels.includes(model))) {
      return { allowed: false, reason: `Image model is not allowed: ${model ?? 'default'}` }
    }
  }

  return { allowed: true }
}

export type RequestedCapability = { capability: SkillCapability; scope: CapabilityScope }

export function calculateCapabilityDiff(previous: readonly RequestedCapability[], next: readonly RequestedCapability[]) {
  const previousByCapability = new Map(previous.map((entry) => [entry.capability, entry.scope]))
  const nextByCapability = new Map(next.map((entry) => [entry.capability, entry.scope]))
  const added: SkillCapability[] = []
  const removed: SkillCapability[] = []
  const broadened: SkillCapability[] = []
  const narrowed: SkillCapability[] = []
  const unchanged: SkillCapability[] = []

  for (const [capability, scope] of nextByCapability) {
    const before = previousByCapability.get(capability)
    if (!before) {
      added.push(capability)
    } else if (isScopeSubset(scope, before) && isScopeSubset(before, scope)) {
      unchanged.push(capability)
    } else if (isScopeSubset(scope, before)) {
      narrowed.push(capability)
    } else {
      broadened.push(capability)
    }
  }
  for (const capability of previousByCapability.keys()) if (!nextByCapability.has(capability)) removed.push(capability)
  return { added, removed, broadened, narrowed, unchanged }
}

export type StoredCapabilityGrant = {
  id: string
  capability: string
  grant_mode: string
  scope_json: string
  granted_by: string | null
  granted_at: number
  expires_at: number | null
  revoked_at: number | null
  session_id: string | null
  consumed_at: number | null
}

export function selectInheritableGrants(grants: readonly StoredCapabilityGrant[], requested: readonly RequestedCapability[]): StoredCapabilityGrant[] {
  const requestedByCapability = new Map(requested.map((entry) => [entry.capability, entry.scope]))
  return grants.filter((grant) => {
    if (grant.revoked_at !== null || grant.consumed_at !== null || grant.expires_at !== null && grant.expires_at <= Date.now()) return false
    const capability = skillCapabilitySchema.safeParse(grant.capability)
    if (!capability.success) return false
    const requestedScope = requestedByCapability.get(capability.data)
    if (!requestedScope) return false
    try {
      const scope = capabilityScopeSchema.safeParse(JSON.parse(grant.scope_json))
      return scope.success && isScopeSubset(requestedScope, scope.data)
    } catch {
      return false
    }
  })
}

function isScopeSubset(candidate: CapabilityScope, boundary: CapabilityScope): boolean {
  return isArraySubset(candidate.allowedRoots, boundary.allowedRoots)
    && isArraySubset(candidate.allowedDomains, boundary.allowedDomains)
    && isArraySubset(candidate.allowedModels, boundary.allowedModels)
    && (boundary.maxCalls === undefined || candidate.maxCalls !== undefined && candidate.maxCalls <= boundary.maxCalls)
}

function isArraySubset(candidate: readonly string[] | undefined, boundary: readonly string[] | undefined): boolean {
  if (!boundary) return true
  if (!candidate) return false
  return candidate.every((value) => boundary.includes(value))
}
