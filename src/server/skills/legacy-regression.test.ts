import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadLegacyRuntime() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../db/client')
  await client.runMigrations()
  const { skillRepo } = await import('../db/repositories/skill.repo')
  const { skillPackageRepo } = await import('../db/repositories/skill-package.repo')
  const { createSkillService } = await import('../services/skill.service')

  return { skillRepo, skillPackageRepo, createSkillService }
}

describe('legacy skill runtime regression', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-legacy-skills-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('blocks js-function skills through the real service before creating a legacy run', async () => {
    const { skillRepo, skillPackageRepo, createSkillService } = await loadLegacyRuntime()
    const skill = skillRepo.create({
      name: 'Add',
      description: 'Adds two numbers',
      type: 'js-function',
      source: 'function run(input) { console.log("adding"); return { total: input.a + input.b } }',
    })
    const service = createSkillService({ skillRepo, skillPackageRepo })

    await expect(service.run(`legacy:${skill.id}`, { a: 2, b: 3 })).rejects.toMatchObject({
      code: 'LEGACY_SKILL_RUN_DISABLED',
    })

    expect(skillRepo.listRuns(skill.id)).toHaveLength(0)
  })

  it('blocks http-api skills through the real service without making a network request', async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      headers: { get: () => 'application/json' },
      json: async () => ({ requestedUrl: url }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { skillRepo, skillPackageRepo, createSkillService } = await loadLegacyRuntime()
    const skill = skillRepo.create({
      name: 'HTTP Echo',
      description: 'Echoes URL',
      type: 'http-api',
      source: JSON.stringify({ url: 'https://example.test/search?q={{query}}', method: 'GET' }),
    })
    const service = createSkillService({ skillRepo, skillPackageRepo })

    await expect(service.run(`legacy:${skill.id}`, { query: 'hello world' })).rejects.toMatchObject({
      code: 'LEGACY_SKILL_RUN_DISABLED',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(skillRepo.listRuns(skill.id)).toHaveLength(0)
  })

  it('blocks prompt-template skills through the real service before contacting the legacy model endpoint', async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ content: [{ text: 'Bonjour' }] }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { skillRepo, skillPackageRepo, createSkillService } = await loadLegacyRuntime()
    const skill = skillRepo.create({
      name: 'Translate',
      description: 'Translates text',
      type: 'prompt-template',
      source: 'Translate {{text}} to French.',
    })
    const service = createSkillService({ skillRepo, skillPackageRepo })

    await expect(service.run(`legacy:${skill.id}`, { text: 'Hello' })).rejects.toMatchObject({
      code: 'LEGACY_SKILL_RUN_DISABLED',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(skillRepo.listRuns(skill.id)).toHaveLength(0)
  })
})
