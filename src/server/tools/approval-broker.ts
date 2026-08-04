import { decodeApprovalToken, hashApprovalInput, getApprovalTokenSecret, type ApprovalTokenPayload } from './approval-token'

export type ApprovalBrokerOptions = {
  secret?: string
  now?: () => number
}

export type ApprovalIntent = {
  toolId: string
  sessionId: string
  input: Record<string, unknown>
}

export class ApprovalBroker {
  private readonly consumed = new Set<string>()
  private readonly secret: string
  private readonly now: () => number

  constructor(options: ApprovalBrokerOptions = {}) {
    this.secret = options.secret ?? getApprovalTokenSecret()
    this.now = options.now ?? Date.now
  }

  consume(token: string, intent: ApprovalIntent): { approved: true; approvalId: string } {
    const payload = decodeApprovalToken(token, this.secret)
    this.assertPayload(payload, intent)
    if (this.consumed.has(payload.approvalId)) throw new Error('Approval token has already been consumed')
    this.consumed.add(payload.approvalId)
    return { approved: true, approvalId: payload.approvalId }
  }

  clear(): void {
    this.consumed.clear()
  }

  private assertPayload(payload: ApprovalTokenPayload, intent: ApprovalIntent): void {
    if (payload.expiresAt <= this.now()) throw new Error('Approval token is expired')
    if (payload.toolId !== intent.toolId) throw new Error('Approval token tool mismatch')
    if (payload.sessionId !== intent.sessionId) throw new Error('Approval token session mismatch')
    if (payload.inputHash !== hashApprovalInput(intent.input)) throw new Error('Approval token input mismatch')
  }
}

export const approvalBroker = new ApprovalBroker()
