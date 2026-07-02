// Shared attachment types and constants, used by both the renderer (upload UI / validation)
// and the server (storage / extraction). Keep this dependency-free so it imports cleanly on
// both sides.

/** Per-file upload ceiling: 5 MB. */
export const ATTACHMENT_MAX_SIZE = 5 * 1024 * 1024

/**
 * Allowed file extensions (lower-case, no dot). "Word" support is docx only — the legacy
 * binary .doc format is not extractable by mammoth, so it is rejected with a clear message.
 */
export const ALLOWED_ATTACHMENT_EXTS = ['md', 'markdown', 'txt', 'csv', 'pdf', 'docx'] as const
export type AttachmentExt = (typeof ALLOWED_ATTACHMENT_EXTS)[number]

/** `accept` attribute string for the hidden <input type="file">. */
export const ATTACHMENT_ACCEPT = '.md,.markdown,.txt,.csv,.pdf,.docx'

/**
 * Metadata for one stored attachment. `path` is the server-side absolute storage path and is
 * only meaningful server-side — the persisted/echoed form omits it (see toClientAttachment).
 */
export interface Attachment {
  id: string
  name: string
  ext: string
  size: number
  path: string
  uploadedAt: number
}

/** The subset safe to send to the client / persist in message parts (no server path). */
export type ClientAttachment = Omit<Attachment, 'path'>

/** Lower-case extension without the leading dot, or '' when the name has none. */
export function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function isAllowedExt(ext: string): ext is AttachmentExt {
  return (ALLOWED_ATTACHMENT_EXTS as readonly string[]).includes(ext.toLowerCase())
}

/** Strip the server path so the metadata can be persisted / echoed to the renderer. */
export function toClientAttachment(att: Attachment): ClientAttachment {
  const { path: _path, ...rest } = att
  return rest
}

/** Human-friendly size label, e.g. "1.2 MB" / "834 KB". */
export function formatAttachmentSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}
