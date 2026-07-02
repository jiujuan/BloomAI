import fs from 'fs'
import os from 'os'
import path from 'path'
import { expandPath, readConfigValue } from '../config/config'

export function getDataDir(): string {
  const configured = readConfigValue('DATA_DIR').value
  return configured ? expandPath(configured) : path.join(os.homedir(), '.bloomai')
}

export function getDbPath(): string {
  return path.join(getDataDir(), 'bloomai.db')
}

/**
 * Root directory for saved generated images. Defaults to <dataDir>/images; callers may pass
 * a user-configured override (settings `image_output_dir`), supporting `~` and absolute paths.
 */
export function getImagesDir(override?: string): string {
  const trimmed = override?.trim()
  if (trimmed) {
    return trimmed.startsWith('~') ? path.join(os.homedir(), trimmed.slice(1)) : path.resolve(trimmed)
  }
  return path.join(getDataDir(), 'images')
}

export function ensureDataDir(): void {
  fs.mkdirSync(getDataDir(), { recursive: true })
}

/**
 * Root directory for chat attachments. Reads `DATA_DIR_ATTACHMENT` (supports `~` and relative
 * paths); defaults to <dataDir>/attachment when unset.
 */
export function getAttachmentBaseDir(): string {
  const configured = readConfigValue('DATA_DIR_ATTACHMENT').value
  return configured ? expandPath(configured) : path.join(getDataDir(), 'attachment')
}

/** Local YYYYMMDD stamp, e.g. 20260702. */
function dateStamp(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

/** Dated attachment directory (<base>/<YYYYMMDD>), created if missing. */
export function getAttachmentDir(date: Date = new Date()): string {
  const dir = path.join(getAttachmentBaseDir(), dateStamp(date))
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Guard against path traversal: true only when `p` resolves inside the attachment base dir.
 * Callers must run this before reading a client-supplied attachment path.
 */
export function isWithinAttachmentDir(p: string): boolean {
  const base = path.resolve(getAttachmentBaseDir())
  const target = path.resolve(p)
  return target === base || target.startsWith(base + path.sep)
}
