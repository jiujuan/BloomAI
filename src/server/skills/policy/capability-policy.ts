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

export const FORBIDDEN_PACKAGE_CAPABILITIES = new Set([
  'shell.execute',
  'python.execute',
  'mcp',
  'mcp.execute',
  'container.execute',
  'arbitrary_workspace_write',
  'workspace.write',
  'dependency.install',
  'home.read',
])

export const capabilityGrantModeSchema = z.enum(['once', 'session', 'persistent'])
export type CapabilityGrantMode = z.infer<typeof capabilityGrantModeSchema>

export const capabilityScopeSchema = z.object({
  allowedRoots: z.array(z.string().min(1)).min(1).optional(),
  allowedDomains: z.array(z.string().min(1)).min(1).optional(),
  allowedModels: z.array(z.string().min(1)).min(1).optional(),
  maxCalls: z.number().int().positive().optional(),
}).strict()

export type CapabilityScope = {
  readonly allowedRoots?: readonly string[]
  readonly allowedDomains?: readonly string[]
  readonly allowedModels?: readonly string[]
  readonly maxCalls?: number
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

export function isForbiddenPackageCapability(capability: string): boolean {
  return FORBIDDEN_PACKAGE_CAPABILITIES.has(capability)
}

export function isScopeAllowed(check: CapabilityScopeCheck): { allowed: true } | { allowed: false; reason: string } {
  if (check.capability === 'web.fetch' || check.capability === 'web.search') {
    if (!check.scope.allowedDomains) return { allowed: true }
    const rawUrl = typeof check.input.url === 'string' ? check.input.url : typeof check.input.domain === 'string' ? `https://${check.input.domain}` : undefined
    if (!rawUrl) return { allowed: false, reason: 'A URL or domain is required for this scoped capability' }
    try {
      const hostname = new URL(rawUrl).hostname.toLowerCase()
      return check.scope.allowedDomains.some((domain) => {
        const normalized = domain.toLowerCase().replace(/^\*\./, '')
        return hostname === normalized || hostname.endsWith(`.${normalized}`)
      })
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

export function normalizeCapabilityScope(value: unknown): CapabilityScope {
  const parsed = capabilityScopeSchema.safeParse(value ?? {})
  if (!parsed.success) throw new Error(`Invalid capability scope: ${parsed.error.issues[0]?.message ?? 'invalid scope'}`)
  return parsed.data
}

function listIsSubset(granted: readonly string[] | undefined, requested: readonly string[] | undefined): boolean {
  if (!granted) return !requested
  if (!requested) return true
  return granted.every((value) => requested.includes(value))
}

function numberIsSubset(granted: number | undefined, requested: number | undefined): boolean {
  if (granted === undefined) return requested === undefined
  return requested === undefined || granted <= requested
}

export function isScopeSubset(granted: CapabilityScope, requested: CapabilityScope): boolean {
  return listIsSubset(granted.allowedRoots, requested.allowedRoots)
    && listIsSubset(granted.allowedDomains, requested.allowedDomains)
    && listIsSubset(granted.allowedModels, requested.allowedModels)
    && numberIsSubset(granted.maxCalls, requested.maxCalls)
}

export function isScopeEqual(left: CapabilityScope, right: CapabilityScope): boolean {
  return isScopeSubset(left, right) && isScopeSubset(right, left)
}

export type StoredCapabilityGrant = {
  readonly id: string
  readonly capability: string
  readonly grant_mode: string
  readonly scope_json: string
  readonly granted_by: string | null
  readonly granted_at: number
  readonly expires_at: number | null
  readonly revoked_at: number | null
  readonly session_id: string | null
  readonly consumed_at: number | null
}

/** Select grants that can be safely reused when the new request is no broader. */
export function selectInheritableGrants(
  grants: readonly StoredCapabilityGrant[],
  requested: readonly RequestedCapability[],
): StoredCapabilityGrant[] {
  const requestedByCapability = new Map(requested.map((entry) => [entry.capability, entry.scope]))
  return grants.filter((grant) => {
    if (grant.revoked_at !== null || grant.consumed_at !== null || grant.expires_at !== null && grant.expires_at <= Date.now()) return false
    const capability = skillCapabilitySchema.safeParse(grant.capability)
    if (!capability.success) return false
    const requestedScope = requestedByCapability.get(capability.data)
    if (!requestedScope) return false
    try {
      const parsed = capabilityScopeSchema.safeParse(JSON.parse(grant.scope_json))
      return parsed.success && isScopeSubset(requestedScope, parsed.data)
    } catch {
      return false
    }
  })
}

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
    if (!before) added.push(capability)
    else if (isScopeEqual(scope, before)) unchanged.push(capability)
    else if (isScopeSubset(scope, before)) narrowed.push(capability)
    else broadened.push(capability)
  }
  for (const capability of previousByCapability.keys()) if (!nextByCapability.has(capability)) removed.push(capability)
  return { added, removed, broadened, narrowed, unchanged }
}
