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
  const { createSkillService } = await import('../../services/skill.service')
  const {
    resolveLegacySkillId,
    resolvePackageSkillId,
    toLegacySkillReference,
    toPackageSkillReference,
  } = await import('../../../shared/skill-references')
  const { buildLegacySkillTools, getLegacySkillMigrationHint } = await import('../../mastra/tools')

  return {
    skillRepo,
    skillPackageRepo,
    createSkillService,
    resolveLegacySkillId,
    resolvePackageSkillId,
    toLegacySkillReference,
    toPackageSkillReference,
    buildLegacySkillTools,
    getLegacySkillMigrationHint,
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

  it('blocks Legacy execution through the service without creating a skill_runs row', async () => {
    const { skillRepo, skillPackageRepo, createSkillService, toLegacySkillReference } = await loadCompatibilityRuntime()
    const legacy = skillRepo.create({
      name: 'Namespaced adder',
      description: 'Adds two numbers',
      type: 'js-function',
      source: 'function run(input) { return { total: input.a + input.b } }',
    })
    const service = createSkillService({ skillRepo, skillPackageRepo })

    await expect(service.run(toLegacySkillReference(legacy.id), { a: 4, b: 5 })).rejects.toMatchObject({ code: 'LEGACY_SKILL_RUN_DISABLED' })
    expect(skillRepo.listRuns(legacy.id)).toHaveLength(0)
  })

  it('uses distinct Legacy and Package reference namespaces and rejects unprefixed Package IDs', async () => {
    const {
      skillRepo,
      skillPackageRepo,
      resolveLegacySkillId,
      resolvePackageSkillId,
      toLegacySkillReference,
      toPackageSkillReference,
    } = await loadCompatibilityRuntime()
    const legacy = skillRepo.create({
      name: 'Legacy archive',
      description: 'Legacy archive record',
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
    expect(resolveLegacySkillId(`package:${packageRecord.id}`)).toBeUndefined()
    expect(resolvePackageSkillId(`legacy:${legacy.id}`)).toBeUndefined()
    expect(resolvePackageSkillId(packageRecord.id)).toBeUndefined()
    expect(resolveLegacySkillId('legacy:')).toBeUndefined()
    expect(resolvePackageSkillId('package:')).toBeUndefined()
  })

  it('removes Legacy synchronous Mastra tools but retains a structured migration hint', async () => {
    const { buildLegacySkillTools, getLegacySkillMigrationHint } = await loadCompatibilityRuntime()
    expect(Object.keys(buildLegacySkillTools())).not.toContain(expect.stringMatching(/^legacy_skill_/))
    expect(getLegacySkillMigrationHint('legacy:fixture')).toEqual(expect.objectContaining({
      runtimeKind: 'legacy',
      readOnly: true,
      migrationAction: 'preview',
      reference: 'legacy:fixture',
    }))
  })
})
