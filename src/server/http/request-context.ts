import { randomUUID } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'

export const REQUEST_ID_HEADER = 'x-request-id'
const REQUEST_ID_MAX_LENGTH = 200

type RequestContextVariables = {
  requestId: string
}

function validRequestId(value: string | undefined): value is string {
  return Boolean(value && value.length <= REQUEST_ID_MAX_LENGTH && !/[\r\n]/.test(value))
}

export function ensureRequestId(context: Context): string {
  const existing = context.get('requestId' as never) as string | undefined
  const header = context.req.header(REQUEST_ID_HEADER)?.trim()
  const requestId = validRequestId(existing) ? existing : validRequestId(header) ? header : randomUUID()
  context.set('requestId' as never, requestId as never)
  context.header(REQUEST_ID_HEADER, requestId)
  return requestId
}

export function getRequestId(context: Context): string {
  return ensureRequestId(context)
}

/** Establishes a request id before any route, policy, or error handler runs. */
export const requestIdMiddleware: MiddlewareHandler = async (context, next) => {
  const requestId = ensureRequestId(context)
  await next()
  context.header(REQUEST_ID_HEADER, requestId)
}

export type { RequestContextVariables }
