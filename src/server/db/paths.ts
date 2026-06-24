import fs from 'fs'
import os from 'os'
import path from 'path'

export function getDataDir(): string {
  return process.env.DATA_DIR || path.join(os.homedir(), '.bloomai')
}

export function getDbPath(): string {
  return path.join(getDataDir(), 'bloomai.db')
}

export function ensureDataDir(): void {
  fs.mkdirSync(getDataDir(), { recursive: true })
}
