import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadPersonaService() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../db/client')
  await client.runMigrations()
  const { personaRepo } = await import('../db/repositories/persona.repo')
  const { personaService } = await import('./persona.service')
  return { client, personaRepo, personaService }
}

describe('personaService', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-persona-service-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('prevents deleting a built-in persona with a domain error', async () => {
    const { personaService } = await loadPersonaService()

    expect(() => personaService.remove('developer')).toThrowError('Cannot delete built-in persona')
    try {
      personaService.remove('developer')
    } catch (error) {
      expect(error).toMatchObject({ code: 'FORBIDDEN' })
    }
  })

  it('creates, updates, and removes a custom persona', async () => {
    const { personaRepo, personaService } = await loadPersonaService()
    const created = personaService.create({ name: 'Reviewer', system_prompt: 'Review changes.' })

    expect(created).toMatchObject({ name: 'Reviewer', system_prompt: 'Review changes.', model_override: null, is_builtin: 0 })

    const updated = personaService.update(created.id, { model_override: 'gpt-4o' })
    expect(updated.model_override).toBe('gpt-4o')

    personaService.remove(created.id)
    expect(personaRepo.get(created.id)).toBeUndefined()
  })

  it('uses NOT_FOUND for an absent persona', async () => {
    const { personaService } = await loadPersonaService()

    expect(() => personaService.get('missing')).toThrowError('Persona not found')
    try {
      personaService.update('missing', { name: 'Nope' })
    } catch (error) {
      expect(error).toMatchObject({ code: 'NOT_FOUND' })
    }
  })
})