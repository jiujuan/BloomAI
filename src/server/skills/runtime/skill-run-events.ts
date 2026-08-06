import { z } from 'zod'
import {
  getSkillRunEventDefinition,
  isSkillRunEventType,
  SKILL_RUN_EVENT_SCHEMA_VERSION,
  skillRunEventRegistry,
  type SkillRunEventPayload,
  type SkillRunEventType,
} from './skill-run-event-registry'
import {
  sanitizeEventPayload as sanitizeSecurityEventPayload,
  SkillSecurityError,
} from '../security/skill-security-checklist'

export const skillRunEventSchemaVersion = SKILL_RUN_EVENT_SCHEMA_VERSION
export const maxEventPayloadBytes = 8 * 1024

const base64KeyPattern = /(?:^|_)(?:b64|base64)(?:_|$)/i
const base64DataUriPattern = /^data:[^,]+;base64,/i
const producerPattern = /^[a-z][a-z0-9._-]{0,127}$/i

export const skillRunEventInputSchema = z.object({
  type: z.string(),
  payload: z.record(z.unknown()),
  producer: z.string().optional(),
})

export type SkillRunEventInput = {
  type: SkillRunEventType
  payload: SkillRunEventPayload
  producer?: string
  occurredAt?: number
}

export type NormalizedSkillRunEvent = {
  schemaVersion: typeof skillRunEventSchemaVersion
  type: SkillRunEventType
  payload: SkillRunEventPayload
  producer: string
  occurredAt: number
}

export class SkillRunEventProtocolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'SkillRunEventProtocolError'
  }
}

export function normalizeSkillRunEvent(input: { type: string; payload: Record<string, unknown>; producer?: string; occurredAt?: number }): NormalizedSkillRunEvent {
  const parsedInput = skillRunEventInputSchema.safeParse(input)
  if (!parsedInput.success) throw new SkillRunEventProtocolError('INVALID_EVENT_PAYLOAD', 'Skill run event payload must be an object')

  const definition = getSkillRunEventDefinition(input.type)
  if (!definition || !isSkillRunEventType(input.type)) {
    throw new SkillRunEventProtocolError('UNKNOWN_EVENT_TYPE', `Unknown skill run event type: ${input.type}`)
  }

  const producer = input.producer ?? 'runtime'
  if (!producerPattern.test(producer)) {
    throw new SkillRunEventProtocolError('INVALID_EVENT_PRODUCER', 'Skill run event producer is invalid')
  }
  const occurredAt = input.occurredAt ?? Date.now()
  if (!Number.isSafeInteger(occurredAt) || occurredAt < 0) {
    throw new SkillRunEventProtocolError('INVALID_EVENT_TIME', 'Skill run event occurredAt must be a non-negative integer')
  }

  const sanitizedPayload = sanitizePayload(input.payload)
  const payloadResult = definition.payload.safeParse(sanitizedPayload)
  if (!payloadResult.success) {
    throw new SkillRunEventProtocolError('INVALID_EVENT_PAYLOAD', `Invalid skill run event payload: ${payloadResult.error.issues[0]?.message ?? 'schema validation failed'}`)
  }

  let serialized: string
  try {
    serialized = JSON.stringify(payloadResult.data)
  } catch {
    throw new SkillRunEventProtocolError('INVALID_EVENT_PAYLOAD', 'Skill run event payload must be JSON serializable')
  }
  if (Buffer.byteLength(serialized, 'utf8') > maxEventPayloadBytes) {
    throw new SkillRunEventProtocolError('EVENT_PAYLOAD_TOO_LARGE', `Skill run event payload exceeds ${maxEventPayloadBytes} bytes`)
  }

  return {
    schemaVersion: definition.schemaVersion as typeof skillRunEventSchemaVersion,
    type: input.type,
    payload: payloadResult.data as SkillRunEventPayload,
    producer,
    occurredAt,
  }
}

function sanitizePayload(value: unknown): SkillRunEventPayload {
  let sanitized: unknown
  try {
    sanitized = sanitizeSecurityEventPayload(value)
  } catch (error) {
    if (error instanceof SkillRunEventProtocolError) throw error
    if (error instanceof SkillSecurityError) {
      const code = error.code.startsWith('PAYLOAD_') ? error.code : 'INVALID_EVENT_PAYLOAD'
      throw new SkillRunEventProtocolError(code, error.message)
    }
    throw new SkillRunEventProtocolError('INVALID_EVENT_PAYLOAD', 'Skill run event payload must be JSON serializable')
  }

  rejectBase64Markers(sanitized)
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) {
    throw new SkillRunEventProtocolError('INVALID_EVENT_PAYLOAD', 'Skill run event payload must be an object')
  }
  return sanitized as SkillRunEventPayload
}

function rejectBase64Markers(value: unknown, seen = new WeakSet<object>()): void {
  if (typeof value === 'string') {
    if (base64DataUriPattern.test(value)) rejectBase64Payload()
    return
  }
  if (!value || typeof value !== 'object') return
  if (seen.has(value)) throw new SkillRunEventProtocolError('INVALID_EVENT_PAYLOAD', 'Skill run event payload cannot contain circular references')
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      for (const child of value) rejectBase64Markers(child, seen)
      return
    }
    for (const [key, child] of Object.entries(value)) {
      if (base64KeyPattern.test(key)) rejectBase64Payload()
      rejectBase64Markers(child, seen)
    }
  } finally {
    seen.delete(value)
  }
}

function rejectBase64Payload(): never {
  throw new SkillRunEventProtocolError('EVENT_BASE64_FORBIDDEN', 'Skill run event payload must not contain Base64 media')
}

export { skillRunEventRegistry }