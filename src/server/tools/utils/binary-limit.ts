import fs from 'node:fs'
import { validateExternalUrl, validateRedirectTarget, type UrlLookup } from './url-policy'

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const

export type LimitedBinary = {
  bytes: Uint8Array
  bytesRead: number
  truncated: boolean
}

export type FetchBinaryOptions = {
  maxBytes?: number
  timeoutMs?: number
  maxRedirects?: number
  signal?: AbortSignal
  lookup?: UrlLookup
  allowedMimeTypes?: readonly string[]
}

export type FetchedBinary = LimitedBinary & {
  url: string
  finalUrl: string
  contentType: string
}

export async function readBinaryResponseLimited(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<LimitedBinary> {
  assertPositiveLimit(maxBytes)
  throwIfAborted(signal)

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) {
      return { bytes: bytes.subarray(0, maxBytes), bytesRead: bytes.byteLength, truncated: true }
    }
    return { bytes, bytesRead: bytes.byteLength, truncated: false }
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytesRead = 0
  let truncated = false
  try {
    while (true) {
      throwIfAborted(signal)
      const { done, value } = await reader.read()
      if (done) break
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value)
      if (bytesRead + chunk.byteLength > maxBytes) {
        const remaining = maxBytes - bytesRead
        if (remaining > 0) chunks.push(chunk.subarray(0, remaining))
        bytesRead += chunk.byteLength
        truncated = true
        await reader.cancel('binary byte limit reached').catch(() => {})
        break
      }
      chunks.push(chunk)
      bytesRead += chunk.byteLength
    }
  } finally {
    reader.releaseLock()
  }

  return {
    bytes: joinChunks(chunks, Math.min(bytesRead, maxBytes)),
    bytesRead,
    truncated,
  }
}

export async function readBinaryFileLimited(
  filePath: string,
  maxBytes = MAX_IMAGE_BYTES,
  signal?: AbortSignal,
): Promise<LimitedBinary> {
  assertPositiveLimit(maxBytes)
  throwIfAborted(signal)
  const stat = await fs.promises.stat(filePath)
  if (stat.size > maxBytes) throw new Error(`Binary resource exceeds the ${maxBytes}-byte limit`)

  const handle = await fs.promises.open(filePath, 'r')
  try {
    const bytes = new Uint8Array(stat.size)
    let offset = 0
    while (offset < bytes.byteLength) {
      throwIfAborted(signal)
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    return { bytes: bytes.subarray(0, offset), bytesRead: offset, truncated: false }
  } finally {
    await handle.close()
  }
}

export async function fetchBinaryLimited(
  rawUrl: string,
  options: FetchBinaryOptions = {},
): Promise<FetchedBinary> {
  const {
    maxBytes = MAX_IMAGE_BYTES,
    timeoutMs = 20_000,
    maxRedirects = 5,
    signal,
    lookup,
    allowedMimeTypes = IMAGE_MIME_TYPES,
  } = options
  assertPositiveLimit(maxBytes)
  let currentUrl = (await validateExternalUrl(rawUrl, { lookup })).toString()
  let response: Response

  for (let redirectCount = 0; ; redirectCount += 1) {
    throwIfAborted(signal)
    response = await fetch(currentUrl, {
      redirect: 'manual',
      signal: combineSignals(signal, AbortSignal.timeout(timeoutMs)),
    })
    if (response.status < 300 || response.status >= 400) break

    const location = response.headers.get('location')
    await response.body?.cancel().catch(() => {})
    if (!location) throw new Error(`Binary download redirect has no location for ${rawUrl}`)
    if (redirectCount >= maxRedirects) throw new Error(`Too many redirects for ${rawUrl}`)
    currentUrl = (await validateRedirectTarget(location, currentUrl, { lookup })).toString()
  }

  if (!response.ok) throw new Error(`Binary download failed with HTTP ${response.status}`)
  const contentType = normaliseMimeType(response.headers.get('content-type'))
  if (contentType && !allowedMimeTypes.includes(contentType)) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`Binary download content type is not allowed: ${contentType}`)
  }

  const limited = await readBinaryResponseLimited(response, maxBytes, signal)
  const finalUrl = (await validateExternalUrl(response.url || currentUrl, { lookup })).toString()
  return { ...limited, url: rawUrl, finalUrl, contentType }
}

export function imageMimeFromPath(filePath: string): string {
  const extension = filePath.toLowerCase().split('.').pop()
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'gif') return 'image/gif'
  if (extension === 'webp') return 'image/webp'
  throw new Error('Unsupported image type; use PNG, JPEG, GIF, or WebP')
}

export function normaliseMimeType(value: string | null): string {
  return (value || '').split(';', 1)[0].trim().toLowerCase()
}

function joinChunks(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    const copyLength = Math.min(chunk.byteLength, result.byteLength - offset)
    if (copyLength <= 0) break
    result.set(chunk.subarray(0, copyLength), offset)
    offset += copyLength
  }
  return result
}

function assertPositiveLimit(maxBytes: number): void {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new Error('maxBytes must be a positive integer')
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error('Operation cancelled')
}

function combineSignals(parent: AbortSignal | undefined, timeout: AbortSignal): AbortSignal {
  if (!parent) return timeout
  if (parent.aborted) return parent
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([parent, timeout])
  const controller = new AbortController()
  const abort = (event: Event) => controller.abort((event.target as AbortSignal).reason)
  parent.addEventListener('abort', abort, { once: true })
  timeout.addEventListener('abort', abort, { once: true })
  return controller.signal
}
