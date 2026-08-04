import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

export type ApprovalTokenPayload = {
  version: 1
  approvalId: string
  toolId: string
  sessionId: string
  inputHash: string
  issuedAt: number
  expiresAt: number
  singleUse: true
}

export type CreateApprovalTokenOptions = {
  secret: string
  toolId: string
  sessionId: string
  input: Record<string, unknown>
  now?: number
  ttlMs?: number
}

const DEFAULT_APPROVAL_TTL_MS = 60_000

export function createApprovalToken(options: CreateApprovalTokenOptions): string {
  if (!options.secret) throw new Error('Approval token secret is required')
  if (!options.toolId.trim()) throw new Error('Tool id is required')
  if (!options.sessionId.trim()) throw new Error('Session id is required')

  const issuedAt = options.now ?? Date.now()
  const payload: ApprovalTokenPayload = {
    version: 1,
    approvalId: randomUUID(),
    toolId: options.toolId,
    sessionId: options.sessionId,
    inputHash: hashApprovalInput(options.input),
    issuedAt,
    expiresAt: issuedAt + (options.ttlMs ?? DEFAULT_APPROVAL_TTL_MS),
    singleUse: true,
  }
  const encodedPayload = encodeJson(payload)
  return `bloomai.approval.v1.${encodedPayload}.${sign(encodedPayload, options.secret)}`
}

export function decodeApprovalToken(token: string, secret: string): ApprovalTokenPayload {
  if (!secret) throw new Error('Approval token secret is required')
  const parts = token.split('.')
  if (parts.length !== 5 || parts[0] !== 'bloomai' || parts[1] !== 'approval' || parts[2] !== 'v1') {
    throw new Error('Invalid approval token format')
  }

  const encodedPayload = parts[3]
  const providedSignature = parts[4]
  const expectedSignature = sign(encodedPayload, secret)
  if (!safeEqual(providedSignature, expectedSignature)) throw new Error('Invalid approval token signature')

  let payload: unknown
  try {
    payload = JSON.parse(fromBase64Url(encodedPayload))
  } catch {
    throw new Error('Invalid approval token payload')
  }
  if (!isApprovalTokenPayload(payload)) throw new Error('Invalid approval token payload')
  return payload
}

export function hashApprovalInput(input: Record<string, unknown>): string {
  return createHmac('sha256', 'bloomai-approval-input-v1')
    .update(stableJson(input))
    .digest('hex')
}

export function getApprovalTokenSecret(): string {
  const secret = process.env.TOOL_APPROVAL_TOKEN_SECRET
  if (secret) return secret
  return 'bloomai-development-approval-secret'
}

function isApprovalTokenPayload(value: unknown): value is ApprovalTokenPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<ApprovalTokenPayload>
  return payload.version === 1
    && typeof payload.approvalId === 'string'
    && typeof payload.toolId === 'string'
    && typeof payload.sessionId === 'string'
    && typeof payload.inputHash === 'string'
    && typeof payload.issuedAt === 'number'
    && typeof payload.expiresAt === 'number'
    && payload.singleUse === true
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
