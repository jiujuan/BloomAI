import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createHonoApp } from './app'

const root = resolve(process.cwd())

function source(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

describe('SKL12-P4-002 backend Legacy boundary', () => {
  it('does not register Legacy user route adapters in the application', () => {
    const appSource = source('src/server/http/app.ts')
    expect(appSource).not.toMatch(/routes\/skills|skillsRoutes|routes\/skill-migration|skillMigrationRoutes/)
    expect(appSource).not.toMatch(/app\.route\('\/api\/v1(?:\/skills)?',\s*(?:skillsRoutes|skillMigrationRoutes)\)/)
  })

  it('returns 404 for removed Legacy HTTP paths while Package Runtime remains reachable', async () => {
    const app = createHonoApp()
    const removedRequests: Array<[string, string]> = [
      ['GET', '/api/v1/skills/market'],
      ['POST', '/api/v1/skills/install'],
      ['POST', '/api/v1/skills'],
      ['POST', '/api/v1/skills/legacy-1/run'],
      ['POST', '/api/v1/skills/legacy-1/migration/inspect'],
      ['POST', '/api/v1/skills/legacy-1/migration/preview'],
      ['GET', '/api/v1/skills/legacy-1/migration-history'],
    ]
    for (const [method, path] of removedRequests) {
      const response = await app.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined })
      expect(response.status, `${method} ${path}`).toBe(404)
    }

    const runtimeResponse = await app.request('/api/v1/skill-runtime/capabilities')
    expect(runtimeResponse.status).toBe(200)
  })

  it('removes the deprecated skillRepo default alias while retaining explicit archive access', () => {
    const repositorySource = source('src/server/db/repositories/skill.repo.ts')
    expect(repositorySource).not.toMatch(/export const skillRepo\b/)
    expect(repositorySource).toContain('export const legacySkillRepo')
  })
})