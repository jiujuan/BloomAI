import type { Context, MiddlewareHandler } from 'hono'

export type SkillRole = 'user' | 'admin' | 'owner'

export const SKILL_ROLES = ['user', 'admin', 'owner'] as const

export type SkillOperation =
  | 'runtime.read'
  | 'runtime.manage'
  | 'package.read'
  | 'package.inspect'
  | 'package.install'
  | 'package.update'
  | 'package.delete'
  | 'installation.read'
  | 'installation.manage'
  | 'import.read'
  | 'import.review'
  | 'grant.read'
  | 'grant.manage'
  | 'run.read'
  | 'run.create'
  | 'run.manage'
  | 'artifact.read'
  | 'artifact.export'
  | 'draft.read'
  | 'draft.manage'

const USER_OPERATIONS = new Set<SkillOperation>([
  'runtime.read',
  'package.read',
  'package.inspect',
  'package.install',
  'package.update',
  'package.delete',
  'installation.read',
  'import.read',
  'grant.read',
  'run.read',
  'run.create',
  'artifact.read',
  'draft.read',
])

/**
 * Normalize the temporary role transport used until the application auth
 * context is available. Unknown, missing, and malformed roles intentionally
 * fail closed to the least-privileged user role.
 */
export function getSkillRole(rawRole: string | null | undefined): SkillRole {
  const normalized = rawRole?.trim().toLowerCase()
  return normalized === 'admin' || normalized === 'owner' ? normalized : 'user'
}

/**
 * Resolve the authenticated actor from transport-level identity headers.
 * Request bodies must not be used as an identity source for administrative
 * decisions. The headers are a temporary adapter until the application auth
 * context is wired into Hono.
 */
export function getSkillActor(context: Pick<Context, 'req'>): string | undefined {
  const raw = context.req.header('x-bloom-actor') ?? context.req.header('x-bloom-owner')
  const actor = raw?.trim()
  if (!actor || actor.length > 200 || /[\r\n]/.test(actor)) return undefined
  return actor
}
export function isSkillOperationAllowed(role: SkillRole, operation: SkillOperation): boolean {
  if (role === 'admin' || role === 'owner') return true
  return USER_OPERATIONS.has(operation)
}

function normalizedPath(rawPath: string): string {
  const withoutQuery = rawPath.split('?', 1)[0] ?? rawPath
  const withoutApiPrefix = withoutQuery.replace(/^\/api\/v1(?=\/|$)/, '')
  const trimmed = withoutApiPrefix.replace(/\/{2,}/g, '/').replace(/\/$/, '')
  return trimmed || '/'
}

function hasPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`)
}

/**
 * Map the Package Runtime HTTP surface to stable authorization operations.
 * Returning undefined for an unknown path keeps unrelated API routes out of
 * the Skills policy while still allowing an app-level policy middleware.
 */
export function getSkillOperationForRequest(method: string, rawPath: string): SkillOperation | undefined {
  const normalizedMethod = method.trim().toUpperCase()
  const route = normalizedPath(rawPath)

  if (hasPrefix(route, '/skill-runtime')) {
    if (route === '/skill-runtime/health' && normalizedMethod === 'GET') return undefined
    if (
      hasPrefix(route, '/skill-runtime/settings')
      || hasPrefix(route, '/skill-runtime/feature-flags')
      || hasPrefix(route, '/skill-runtime/diagnostics')
      || hasPrefix(route, '/skill-runtime/audit')
    ) return 'runtime.manage'
    return 'runtime.read'
  }

  if (hasPrefix(route, '/skill-packages')) {
    // Catalog/detail reads are intentionally outside the destructive-operation
    // map. Read access remains explicit in isSkillOperationAllowed for callers
    // that need to evaluate it without forcing a role gate on list rendering.
    if (normalizedMethod === 'GET') return undefined
    if (route === '/skill-packages/inspect' && normalizedMethod === 'POST') return 'package.inspect'
    if (route === '/skill-packages/install' && normalizedMethod === 'POST') return 'package.install'
    if (route.endsWith('/update/preview') && normalizedMethod === 'POST') return 'package.update'
    if (route.endsWith('/update') && normalizedMethod === 'POST') return 'package.update'
    if (normalizedMethod === 'PATCH') return 'package.update'
    if (normalizedMethod === 'DELETE') return 'package.delete'
    return undefined
  }

  if (hasPrefix(route, '/skill-installations')) {
    if (normalizedMethod === 'GET') return 'installation.read'
    return 'installation.manage'
  }

  if (hasPrefix(route, '/skill-import-reviews')) {
    if (normalizedMethod === 'GET') return 'import.read'
    return 'import.review'
  }

  if (hasPrefix(route, '/skill-capability-grants')) {
    if (normalizedMethod === 'GET') return 'grant.read'
    return 'grant.manage'
  }

  if (hasPrefix(route, '/skill-runs')) {
    if (normalizedMethod === 'GET') return 'run.read'
    if (route === '/skill-runs' && normalizedMethod === 'POST') return 'run.create'
    return 'run.manage'
  }

  if (hasPrefix(route, '/skill-artifacts')) {
    if (route.endsWith('/export') && normalizedMethod === 'POST') return 'artifact.export'
    return normalizedMethod === 'GET' ? 'artifact.read' : 'artifact.export'
  }

  if (hasPrefix(route, '/skill-drafts')) {
    if (normalizedMethod === 'GET') return 'draft.read'
    return 'draft.manage'
  }

  return undefined
}

export type SkillAuthorizationOptions = {
  operation?: (context: Context) => SkillOperation | undefined
}

/** Hono middleware for the Package Runtime authorization boundary. */
export function skillAuthorizationMiddleware(options: SkillAuthorizationOptions = {}): MiddlewareHandler {
  const resolveOperation = options.operation ?? ((context) => getSkillOperationForRequest(context.req.method, context.req.path))
  return async (context, next) => {
    const operation = resolveOperation(context)
    if (!operation) return next()

    const role = getSkillRole(context.req.header('x-bloom-role'))
    if (isSkillOperationAllowed(role, operation)) return next()

    const requestId = context.get('requestId' as never) as string | undefined
    const response = {
      error: {
        code: 'FORBIDDEN',
        message: 'Skills operation requires administrator access',
        details: { operation },
        retryable: false,
        ...(requestId ? { requestId } : {}),
      },
    }
    return context.json(response, 403)
  }
}
