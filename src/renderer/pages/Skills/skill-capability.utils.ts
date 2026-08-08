import type { CapabilityGrant, CapabilityScope } from './skill-runtime.types'

export type CapabilityGrantState = 'requested' | 'approved' | 'rejected' | 'revoked' | 'expired' | 'consumed' | 'unknown'

export function formatCapabilityScope(scope: CapabilityScope | Record<string, unknown> | undefined): string {
  if (!scope || Object.keys(scope).length === 0) return '未限定 scope'
  const entries: string[] = []
  const add = (label: string, value: unknown) => {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) return
    entries.push(`${label}：${Array.isArray(value) ? value.join(', ') : String(value)}`)
  }
  const allowedRoots = scope.allowedRoots ?? scope.allowed_roots
  const allowedDomains = scope.allowedDomains ?? scope.allowed_domains
  const allowedModels = scope.allowedModels ?? scope.allowed_models
  const maxCalls = scope.maxCalls ?? scope.max_calls
  add('允许目录', allowedRoots)
  add('允许域名', allowedDomains)
  add('允许模型', allowedModels)
  add('调用预算', maxCalls === undefined ? undefined : `${maxCalls} 次`)
  for (const [key, value] of Object.entries(scope)) {
    if (['allowedRoots', 'allowed_roots', 'allowedDomains', 'allowed_domains', 'allowedModels', 'allowed_models', 'maxCalls', 'max_calls'].includes(key)) continue
    add(key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, (value) => value.toUpperCase()), value)
  }
  return entries.length ? entries.join(' · ') : '未限定 scope'
}

export function getCapabilityGrantState(grant: CapabilityGrant): CapabilityGrantState {
  const revokedAt = grant.revokedAt ?? grant.revoked_at
  const consumedAt = grant.consumedAt ?? grant.consumed_at
  const expiresAt = grant.expiresAt ?? grant.expires_at
  if (revokedAt != null || grant.status === 'revoked') return 'revoked'
  if (consumedAt != null) return 'consumed'
  if (expiresAt != null && expiresAt <= Date.now()) return 'expired'
  if (grant.status === 'approved' || grant.status === 'rejected' || grant.status === 'requested' || grant.status === 'expired') return grant.status
  return grant.status ? 'unknown' : 'approved'
}

export function capabilityStateLabel(state: CapabilityGrantState) {
  return { requested: '待审批', approved: '已批准', rejected: '已拒绝', revoked: '已撤销', expired: '已过期', consumed: '已消费', unknown: '未知' }[state]
}

export function capabilityStateTone(state: CapabilityGrantState) {
  if (state === 'approved') return 'success'
  if (state === 'rejected' || state === 'revoked' || state === 'expired') return 'danger'
  if (state === 'requested') return 'warning'
  return 'muted'
}
