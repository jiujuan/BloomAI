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
