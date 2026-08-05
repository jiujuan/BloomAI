import { z } from 'zod'

export const SKILL_RUN_EVENT_SCHEMA_VERSION = 1 as const

const objectPayload = z.record(z.unknown())
const revisionPayload = z.object({ revision: z.number().int().nonnegative() }).passthrough()

export const skillRunEventRegistry = {
  'package.loaded': { schemaVersion: SKILL_RUN_EVENT_SCHEMA_VERSION, payload: z.object({ packageId: z.string().optional(), skillVersionId: z.string().optional() }).passthrough() },
  'package.file_loaded': { schemaVersion: SKILL_RUN_EVENT_SCHEMA_VERSION, payload: z.object({ path: z.string(), sha256: z.string(), sizeBytes: z.number().int().nonnegative() }).passthrough() },
  'input.summarized': { schemaVersion: SKILL_RUN_EVENT_SCHEMA_VERSION, payload: z.object({ keys: z.array(z.string()), byteLength: z.number().int().nonnegative() }).passthrough() },
  'step.started': { schemaVersion: SKILL_RUN_EVENT_SCHEMA_VERSION, payload: z.object({ title: z.string().max(512) }).passthrough() },
  'step.completed': { schemaVersion: SKILL_RUN_EVENT_SCHEMA_VERSION, payload: z.object({ title: z.string().max(512) }).passthrough() },
  'capability.requested': { schemaVersion: SKILL_RUN_EVENT_SCHEMA_VERSION, payload: z.object({ capability: z.string() }).passthrough() },
  'capability.approval_required': { schemaVersion: SKILL_RUN_EVENT_SCHEMA_VERSION, payload: z.object({ capability: z.string().optional(), reason: z.string().max(2_000).optional() }).passthrough() },
  'capability.started': { schemaVersion: SKILL_RUN_EVENT_SCHEMA_VERSION, payload: z.object({ capability: z.string().optional() }).passthrough() },
  'capability.completed': { schemaVersion: SKILL_RUN_EVENT_SCHEMA_VERSION, payload: z.object({ capability: z.string().optional() }).passthrough() },
  'capability.failed': { schemaVersion: SKILL_RUN_EVENT_SCHEMA_VERSION, payload: z.object({ capability: z.string().optional(), errorCode: z.string().optional() }).passthrough() },
  'capability.call': { schemaVersion: SKILL_RUN_EVENT_SCHEMA_VERSION, payload: z.object({ capability: z.string(), toolId: z.string(), toolRunId: z.string(), status: z.enum(['completed', 'failed']) }).passthrough() },
  'approval.required': { schemaVersion: SKILL_RUN_EVENT_SCHEMA_VERSION, payload: z.object({ reason: z.string().max(2_000), capabilities: z.array(z.string()) }).passthrough() },
  'artifact.created': { schemaVersion: SKILL_RUN_EVENT_SCHEMA_VERSION, payload: z.object({ artifactId: z.string(), kind: z.string(), path: z.string(), sha256: z.string(), sizeBytes: z.number().int().nonnegative() }).passthrough() },
  'run.started': { schemaVersion: SKILL_RUN_EVENT_SCHEMA_VERSION, payload: revisionPayload },
  'run.status_changed': { schemaVersion: SKILL_RUN_EVENT_SCHEMA_VERSION, payload: z.object({ from: z.string(), to: z.string(), revision: z.number().int().nonnegative() }).passthrough() },
  'run.waiting': { schemaVersion: SKILL_RUN_EVENT_SCHEMA_VERSION, payload: revisionPayload },
  'run.resumed': { schemaVersion: SKILL_RUN_EVENT_SCHEMA_VERSION, payload: revisionPayload },
  'run.interrupted': { schemaVersion: SKILL_RUN_EVENT_SCHEMA_VERSION, payload: revisionPayload },
  'run.completed': { schemaVersion: SKILL_RUN_EVENT_SCHEMA_VERSION, payload: revisionPayload },
  'run.completed_with_errors': { schemaVersion: SKILL_RUN_EVENT_SCHEMA_VERSION, payload: revisionPayload },
  'run.cancel_requested': { schemaVersion: SKILL_RUN_EVENT_SCHEMA_VERSION, payload: revisionPayload },
  'run.cancelled': { schemaVersion: SKILL_RUN_EVENT_SCHEMA_VERSION, payload: revisionPayload },
  'run.failed': { schemaVersion: SKILL_RUN_EVENT_SCHEMA_VERSION, payload: z.object({ code: z.string(), message: z.string().max(2_000), revision: z.number().int().nonnegative() }).passthrough() },
} as const satisfies Record<string, { schemaVersion: number; payload: z.ZodTypeAny }>

export type SkillRunEventType = keyof typeof skillRunEventRegistry
export type SkillRunEventPayload = Record<string, unknown>

export function getSkillRunEventDefinition(type: string) {
  return (skillRunEventRegistry as Record<string, { schemaVersion: number; payload: z.ZodTypeAny }>)[type]
}

export function isSkillRunEventType(type: string): type is SkillRunEventType {
  return Boolean(getSkillRunEventDefinition(type))
}

export const skillRunEventTypes = Object.freeze(Object.keys(skillRunEventRegistry) as SkillRunEventType[])