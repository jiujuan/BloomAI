import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanSkillsBaseline } from '../../../scripts/skills/p0-baseline-scan'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('Skills Admin P0 baseline scanner', () => {
  it('produces a deterministic Legacy dependency inventory across imports, routes, schema and fixtures', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-p0-scan-'))
    temporaryRoots.push(root)
    const files: Record<string, string> = {
      'src/renderer/App.tsx': "import { LegacySkillsMarket } from './pages/Skills/LegacySkillsMarket'\n",
      'src/server/http/routes/skills.ts': "app.get('/skills', legacyHandler)\n",
      'src/server/db/schema.ts': "export const skills = sqliteTable('skills', {})\nexport const skill_runs = sqliteTable('skill_runs', {})\n",
      'tests/fixtures/skills/legacy.json': '{"type":"legacy"}\n',
    }
    for (const [relative, content] of Object.entries(files)) {
      const target = path.join(root, relative)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, content)
    }

    const result = scanSkillsBaseline(root)
    expect(result.schemaVersion).toBe('skills-admin-p0-baseline-v1')
    expect(result.legacyReferences.map((reference) => reference.kind)).toEqual(expect.arrayContaining(['import', 'route', 'schema/database', 'test/fixture']))
    expect(result.legacyReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ disposition: 'delete' }),
      expect.objectContaining({ disposition: 'migrate-retain' }),
      expect.objectContaining({ disposition: 'audit-retain' }),
    ]))
    expect(result.dependencyGraph.nodes.length).toBeGreaterThan(0)
    expect(result.dependencyGraph.edges.length).toBeGreaterThan(0)
    expect(scanSkillsBaseline(root)).toEqual(result)
  })
})
