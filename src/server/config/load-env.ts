import fs from 'node:fs'
import path from 'node:path'

/**
 * Loads .env into process.env (without overriding already-set vars) so AI SDK
 * providers and provider key lookups (e.g. AGNES_API_KEY) work in the forked
 * server process. Mirrors the minimal parser used by the smoke script.
 */
export function loadDotEnv(envPath = path.join(process.cwd(), '.env')): void {
  if (!fs.existsSync(envPath)) return
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const line = rawLine.startsWith('export ') ? rawLine.slice(7) : rawLine
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!match) continue
    const [, key, rawValue] = match
    if (process.env[key]) continue
    process.env[key] = rawValue.trim().replace(/^['"]|['"]$/g, '')
  }
}
