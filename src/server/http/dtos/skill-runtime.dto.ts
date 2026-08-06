import type { z } from 'zod'

export type PageMeta = {
  limit: number
  offset: number
  total: number
  hasMore: boolean
  nextOffset: number | null
}

export type Page<T> = {
  data: T[]
  meta: PageMeta
}

export function toPageMeta(input: { limit: number; offset: number }, total: number): PageMeta {
  const hasMore = input.offset + input.limit < total
  return {
    ...input,
    total,
    hasMore,
    nextOffset: hasMore ? input.offset + input.limit : null,
  }
}

export function parsePageQuery<T extends z.ZodTypeAny>(schema: T, query: Record<string, string | undefined>): z.infer<T> {
  return schema.parse(query)
}

export type SkillRuntimeEventDto = {
  id: string
  runId: string
  seq: number
  schemaVersion: number
  producer: string
  type: string
  payload: Record<string, unknown>
  occurredAt: number
  createdAt: number
}

export type SkillRuntimeErrorDto = {
  code: string
  message: string
  requestId?: string
  retryable?: boolean
}
