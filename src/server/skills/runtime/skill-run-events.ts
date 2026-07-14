import { z } from 'zod'

export const skillRunEventSchemaVersion = 1
const maxEventPayloadBytes = 8 * 1024
const sensitiveKeyPattern = /authorization|api[_-]?key|token|secret|password|headers?|cookies?/i
const base64KeyPattern = /(?:^|_)(?:b64|base64)(?:_|$)/i
const base64DataUriPattern = /^data:[^,]+;base64,/i

const passthroughObject = z.object({}).passthrough()

export const skillRunEventInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('run.status_changed'),
    payload: z.object({ from: z.string(), to: z.string(), revision: z.number().int().nonnegative() }),
  }),
  z.object({
    type: z.literal('input.summarized'),
    payload: z.object({ keys: z.array(z.string()), byteLength: z.number().int().nonnegative() }),
  }),
  z.object({
    type: z.literal('package.file_loaded'),
    payload: z.object({ path: z.string(), sha256: z.string(), sizeBytes: z.number().int().nonnegative() }).passthrough(),
  }),
  z.object({ type: z.literal('step.started'), payload: z.object({ title: z.string().max(512) }) }),
  z.object({ type: z.literal('step.completed'), payload: z.object({ title: z.string().max(512) }).passthrough() }),
  z.object({
    type: z.literal('capability.call'),
    payload: z.object({
      capability: z.string(), toolId: z.string(), toolRunId: z.string(), status: z.enum(['completed', 'failed']),
    }).passthrough(),
  }),
  z.object({
    type: z.literal('approval.required'),
    payload: z.object({ reason: z.string().max(2_000), capabilities: z.array(z.string()) }),
  }),
  z.object({
    type: z.literal('artifact.created'),
    payload: z.object({ artifactId: z.string(), kind: z.string(), path: z.string(), sha256: z.string(), sizeBytes: z.number().int().nonnegative() }),
  }),
  z.object({ type: z.literal('run.completed'), payload: z.object({ revision: z.number().int().nonnegative() }) }),
  z.object({ type: z.literal('run.completed_with_errors'), payload: z.object({ revision: z.number().int().nonnegative() }) }),
  z.object({ type: z.literal('run.cancel_requested'), payload: z.object({ revision: z.number().int().nonnegative() }) }),
  z.object({
    type: z.literal('run.failed'),
    payload: z.object({ code: z.string(), message: z.string().max(2_000), revision: z.number().int().nonnegative() }),
  }),
])

export type SkillRunEventInput = z.infer<typeof skillRunEventInputSchema>
export type SkillRunEventType = SkillRunEventInput['type']

export type NormalizedSkillRunEvent = {
  schemaVersion: typeof skillRunEventSchemaVersion
  type: SkillRunEventType
  payload: Record<string, unknown>
}

export function normalizeSkillRunEvent(input: { type: string; payload: Record<string, unknown> }): NormalizedSkillRunEvent {
  const sanitizedPayload = sanitizePayload(input.payload)
  const parsed = skillRunEventInputSchema.safeParse({ type: input.type, payload: sanitizedPayload })
  if (!parsed.success) throw new Error(`Invalid skill run event: ${parsed.error.issues[0]?.message ?? 'schema validation failed'}`)

  const serialized = JSON.stringify(parsed.data.payload)
  if (Buffer.byteLength(serialized, 'utf8') > maxEventPayloadBytes) {
    throw new Error(`Skill run event payload exceeds ${maxEventPayloadBytes} bytes`)
  }
  return { schemaVersion: skillRunEventSchemaVersion, type: parsed.data.type, payload: parsed.data.payload }
}

function sanitizePayload(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeValue(value)
  const parsed = passthroughObject.safeParse(sanitized)
  if (!parsed.success || Array.isArray(sanitized)) throw new Error('Skill run event payload must be an object')
  return parsed.data
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (base64DataUriPattern.test(value)) throw new Error('Skill run event payload must not contain Base64 media')
    return value
  }
  if (Array.isArray(value)) return value.map(sanitizeValue)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    base64KeyPattern.test(key) ? rejectBase64Payload() : sensitiveKeyPattern.test(key) ? '[REDACTED]' : sanitizeValue(child),
  ]))
}

function rejectBase64Payload(): never {
  throw new Error('Skill run event payload must not contain Base64 media')
}
