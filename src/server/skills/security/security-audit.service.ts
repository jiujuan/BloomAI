import {
  sanitizeSecurityPayload,
  SECURITY_POLICY_VERSION,
  type SecurityPayloadOptions,
} from './skill-security-checklist'

export type SecurityDecision = 'allow' | 'deny' | 'review' | 'blocked'

export type SecurityAuditEvent = {
  actor?: string | null
  action: string
  resourceType: string
  resourceId?: string | null
  securityDecision: SecurityDecision
  policyVersion: string
  sourceFingerprint?: string | null
  payload: Record<string, unknown>
}

export type SecurityAuditDependencies = {
  audit: { append: (event: SecurityAuditEvent) => void }
}

export type AuditSecurityDecisionInput = {
  audit: SecurityAuditDependencies['audit']
  actor?: string | null
  action: string
  resourceType: string
  resourceId?: string | null
  securityDecision: SecurityDecision
  policyVersion?: string
  sourceFingerprint?: string | null
  payload?: Record<string, unknown>
  payloadOptions?: SecurityPayloadOptions
}

export function auditSecurityDecision(input: AuditSecurityDecisionInput): SecurityAuditEvent {
  if (!input.action.trim() || !input.resourceType.trim()) throw new Error('Security audit action and resourceType are required')
  if (!/^(?:[a-f0-9]{64})$/i.test(input.sourceFingerprint ?? '')) {
    if (input.sourceFingerprint !== undefined && input.sourceFingerprint !== null) throw new Error('Security audit sourceFingerprint must be a SHA-256 hex string')
  }
  const event: SecurityAuditEvent = {
    actor: input.actor ?? null,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    securityDecision: input.securityDecision,
    policyVersion: input.policyVersion ?? SECURITY_POLICY_VERSION,
    sourceFingerprint: input.sourceFingerprint ?? null,
    payload: (sanitizeSecurityPayload(input.payload ?? {}, input.payloadOptions) ?? {}) as Record<string, unknown>,
  }
  input.audit.append(event)
  return event
}
