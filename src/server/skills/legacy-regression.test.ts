import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadLegacySkills() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../db/client')
  await client.runMigrations()
  const { skillRepo } = await import('../db/repositories/skill.repo')
  const { runSkill } = await import('./run-skill')

  return { skillRepo, runSkill }
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

  it('runs js-function skills and stores successful runs', async () => {
    const { skillRepo, runSkill } = await loadLegacySkills()
    const skill = skillRepo.create({
      name: 'Add',
      description: 'Adds two numbers',
      type: 'js-function',
      source: 'function run(input) { console.log("adding"); return { total: input.a + input.b } }',
    })

    await expect(runSkill(skill.id, { a: 2, b: 3 })).resolves.toEqual({ total: 5, _logs: ['adding'] })

    const runs = skillRepo.listRuns(skill.id)
    expect(runs[0].status).toBe('success')
    expect(JSON.parse(runs[0].output_json)).toEqual({ total: 5, _logs: ['adding'] })
  })

  it('runs http-api skills without changing template interpolation behavior', async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      headers: { get: () => 'application/json' },
      json: async () => ({ requestedUrl: url }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { skillRepo, runSkill } = await loadLegacySkills()
    const skill = skillRepo.create({
      name: 'HTTP Echo',
      description: 'Echoes URL',
      type: 'http-api',
      source: JSON.stringify({ url: 'https://example.test/search?q={{query}}', method: 'GET' }),
    })

    await expect(runSkill(skill.id, { query: 'hello world' })).resolves.toEqual({
      requestedUrl: 'https://example.test/search?q=hello%20world',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/search?q=hello%20world',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('runs prompt-template skills using the legacy Anthropic request shape', async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ content: [{ text: 'Bonjour' }] }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { skillRepo, runSkill } = await loadLegacySkills()
    const { settingsRepo } = await import('../db/repositories/settings.repo')
    settingsRepo.setMany({ anthropic_api_key: 'test-key' })
    const skill = skillRepo.create({
      name: 'Translate',
      description: 'Translates text',
      type: 'prompt-template',
      source: 'Translate {{text}} to French.',
    })

    await expect(runSkill(skill.id, { text: 'Hello' })).resolves.toEqual({
      output: 'Bonjour',
      prompt: 'Translate Hello to French.',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-api-key': 'test-key' }),
      })
    )
  })
})
