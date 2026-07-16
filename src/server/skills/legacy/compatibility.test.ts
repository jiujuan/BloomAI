import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv

async function loadCompatibilityRuntime() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../../db/client')
  await client.runMigrations()
  const { skillRepo } = await import('../../db/repositories/skill.repo')
  const { skillPackageRepo } = await import('../../db/repositories/skill-package.repo')
  const {
    resolveLegacySkillId,
    resolvePackageSkillId,
    toLegacySkillReference,
    toPackageSkillReference,
  } = await import('../../../shared/skill-references')
  const { runSkill } = await import('./run-skill')
  const { toLegacySkillToolId } = await import('./mastra-tool-id')

  return {
    skillRepo,
    skillPackageRepo,
    resolveLegacySkillId,
    resolvePackageSkillId,
    toLegacySkillReference,
    toPackageSkillReference,
    runSkill,
    toLegacySkillToolId,
  }
}

describe('Legacy and Package Skill compatibility boundaries', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-skill-compatibility-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('runs a Legacy Skill through its namespaced reference without changing its stored ID', async () => {
    const { skillRepo, toLegacySkillReference, runSkill } = await loadCompatibilityRuntime()
    const legacy = skillRepo.create({
      name: 'Namespaced adder',
      description: 'Adds two numbers',
      type: 'js-function',
      source: 'function run(input) { return { total: input.a + input.b } }',
    })

    await expect(runSkill(toLegacySkillReference(legacy.id), { a: 4, b: 5 })).resolves.toMatchObject({ total: 9 })
    expect(skillRepo.listRuns(legacy.id)).toHaveLength(1)
  })

  it('uses distinct Legacy and Package reference namespaces', async () => {
    const {
      skillRepo,
      skillPackageRepo,
      resolveLegacySkillId,
      resolvePackageSkillId,
      toLegacySkillReference,
      toPackageSkillReference,
      toLegacySkillToolId,
    } = await loadCompatibilityRuntime()
    const legacy = skillRepo.create({
      name: 'Legacy tool',
      description: 'Legacy Mastra tool',
      type: 'js-function',
      source: 'function run() { return { ok: true } }',
    })
    const packageRecord = skillPackageRepo.createPackage({
      name: 'Package only',
      description: 'Must not be converted to a synchronous tool',
      sourceType: 'local-directory',
    })

    expect(toLegacySkillReference(legacy.id)).toBe(`legacy:${legacy.id}`)
    expect(toPackageSkillReference(packageRecord.id)).toBe(`package:${packageRecord.id}`)
    expect(toLegacySkillReference(legacy.id)).not.toBe(toPackageSkillReference(legacy.id))
    expect(toLegacySkillToolId(legacy.id)).toBe(`legacy_skill_${legacy.id}`)
    expect(resolveLegacySkillId(`package:${packageRecord.id}`)).toBeUndefined()
    expect(resolvePackageSkillId(`legacy:${legacy.id}`)).toBeUndefined()
    expect(resolveLegacySkillId('legacy:')).toBeUndefined()
    expect(resolvePackageSkillId('package:')).toBeUndefined()
  })
})
