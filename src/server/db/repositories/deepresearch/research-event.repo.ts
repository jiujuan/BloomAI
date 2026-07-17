import { and, asc, eq, gt, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import type { JsonObject, ResearchEventDto } from '@shared/deepresearch/contracts'
import type { ResearchEventType } from '@shared/deepresearch/events'
import { getOrmDb } from '../../client'
import { publishResearchEvent } from '@server/deepresearch/research-event-publisher'
import { research_events } from '../../schema'
import { decodeJson, EMPTY_JSON_OBJECT, encodeJson } from './repository-utils'

export interface AppendResearchEventInput {
  runId: string
  type: ResearchEventType
  phase: string
  payload: JsonObject
  timestamp?: number
}

type EventExecutor = any

export function mapResearchEvent(row: typeof research_events.$inferSelect): ResearchEventDto {
  return {
    runId: row.run_id,
    sequence: row.sequence,
    type: row.type,
    phase: row.phase,
    timestamp: row.timestamp,
    payload: decodeJson<JsonObject>(row.payload_json, EMPTY_JSON_OBJECT),
  }
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && /unique|constraint/i.test(error.message)
}

export function appendResearchEventInTransaction(executor: EventExecutor, input: AppendResearchEventInput): ResearchEventDto {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = executor
      .select({ sequence: sql<number>`coalesce(max(${research_events.sequence}), 0)` })
      .from(research_events)
      .where(eq(research_events.run_id, input.runId))
      .get()
    const sequence = Number(current?.sequence ?? 0) + 1
    const id = uuidv4()
    const timestamp = input.timestamp ?? Date.now()

    try {
      executor.insert(research_events).values({
        id,
        run_id: input.runId,
        sequence,
        type: input.type,
        phase: input.phase,
        timestamp,
        payload_json: encodeJson(input.payload),
      }).run()

      return {
        runId: input.runId,
        sequence,
        type: input.type,
        phase: input.phase,
        timestamp,
        payload: input.payload,
      }
    } catch (error) {
      if (attempt === 0 && isUniqueConstraint(error)) continue
      throw error
    }
  }

  throw new Error('Unable to append a Deep Research event after retrying its sequence allocation.')
}

export const researchEventRepo = {
  append(input: AppendResearchEventInput): ResearchEventDto {
    const event = getOrmDb().transaction((tx) => appendResearchEventInTransaction(tx, input))
    publishResearchEvent(event)
    return event
  },

  list(runId: string, afterSequence = 0): ResearchEventDto[] {
    return getOrmDb()
      .select()
      .from(research_events)
      .where(and(eq(research_events.run_id, runId), gt(research_events.sequence, afterSequence)))
      .orderBy(asc(research_events.sequence))
      .all()
      .map(mapResearchEvent)
  },
}
