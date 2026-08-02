import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { getDataDir } from '@server/db/paths'

/**
 * Resolves the LibSQL database reserved for Mastra schedules and their framework
 * state. It intentionally remains separate from BloomAI's Drizzle database and
 * the Deep Research Mastra runtime.
 */
export function resolveScheduleRuntimeUrl(dataDir = getDataDir()): string {
  fs.mkdirSync(dataDir, { recursive: true })
  return pathToFileURL(path.join(dataDir, 'mastra-runtime.db')).href
}
