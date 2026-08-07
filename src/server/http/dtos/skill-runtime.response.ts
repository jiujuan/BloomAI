import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { getRequestId } from '../request-context'
import { toPageMeta, type PageMeta } from './skill-runtime.dto'

export type SuccessMeta = {
  requestId: string
  page?: { limit: number; offset: number; total: number }
  [key: string]: unknown
}

export type PageInput = { limit: number; offset: number }

export function successResponse<T>(
  context: Context,
  data: T,
  status: ContentfulStatusCode = 200,
  meta: Record<string, unknown> = {},
) {
  const requestId = getRequestId(context)
  return context.json({
    data,
    meta: { ...meta, requestId },
  }, status)
}

export function pageSuccess<T>(
  context: Context,
  data: T,
  input: PageInput,
  total: number,
  status: ContentfulStatusCode = 200,
) {
  const pageMeta: PageMeta = toPageMeta(input, total)
  return successResponse(context, data, status, {
    page: { limit: pageMeta.limit, offset: pageMeta.offset, total: pageMeta.total },
    limit: pageMeta.limit,
    offset: pageMeta.offset,
    total: pageMeta.total,
    hasMore: pageMeta.hasMore,
    nextOffset: pageMeta.nextOffset,
  })
}
