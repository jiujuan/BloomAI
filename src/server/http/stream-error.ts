import { logError } from '../logger/logger'
import {
  isKnownResponseErrorCode,
  resolveErrorTimeline,
  type KnownResponseErrorCode,
} from '@shared/llm-response-contract/error-timeline-registry'

/**
 * Unified error handling for the chat streams.
 *
 * Every failure is (a) logged server-side with full detail — including the stack — via
 * {@link logError}, keyed by a stable error code, and (b) surfaced to the client as a short,
 * friendly Chinese message from the shared error-timeline registry. Raw messages / stack traces
 * never reach the UI.
 */

/** Best-effort classification of an arbitrary thrown value into a known error code. */
export function classifyErrorCode(error: unknown): KnownResponseErrorCode {
  const e = error as any
  const name = String(e?.name || '')
  const explicit = typeof e?.code === 'string' ? e.code : ''
  const msg = String(e?.message ?? e ?? '').toLowerCase()

  if (explicit && isKnownResponseErrorCode(explicit)) return explicit
  if (name === 'AbortError' || e?.name === 'TimeoutError' || msg.includes('abort')) return 'STREAM_ABORTED'
  // AI SDK / provider HTTP failures (APICallError, non-2xx, network) → provider error.
  if (name.includes('APICall') || e?.statusCode || e?.status || e?.responseBody || msg.includes('fetch failed') || msg.includes('econn') || msg.includes('timeout')) {
    return 'LLM_PROVIDER_ERROR'
  }
  if (msg.includes('api key') || msg.includes('apikey') || msg.includes('no model') || msg.includes('model not') || msg.includes('unsupported provider') || msg.includes('base url') || msg.includes('baseurl')) {
    return 'LLM_CONFIG_ERROR'
  }
  return 'UNKNOWN_ERROR'
}

/** Friendly, user-facing message for an error (no internals, no stack). */
export function friendlyErrorMessage(error: unknown): string {
  return resolveErrorTimeline({ code: classifyErrorCode(error), message: '' }).timelineMessage
}

/**
 * `onError` handler for `handleChatStream` / `createUIMessageStream`: log the full error
 * (stack included) under `scope`, then return the friendly message that gets streamed to the UI.
 */
export function streamOnError(scope: string, meta?: Record<string, unknown>) {
  return (error: unknown): string => {
    try {
      logError(scope, error, meta)
    } catch {
      /* logging must never mask the original error */
    }
    return friendlyErrorMessage(error)
  }
}
