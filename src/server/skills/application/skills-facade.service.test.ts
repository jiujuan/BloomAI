import { describe, expect, it, vi } from 'vitest'
import { createSkillsFacade } from './skills-facade.service'
import { ServiceError } from '../../services/errors'

const legacySkill = { id: 'legacy-1', name: 'Legacy', description: 'old', type: 'prompt-template', version: '1.0.0', is_installed: 1, author: 'custom' }
const packageRecord = { id: 'package-1', name: 'Package', description: 'new', sourceType: 'local-directory', sourceUri: null, sourceRef: null, createdAt: 1, updatedAt: 2 }
const version = { id: 'version-1', packageId: 'package-1', version: '1.2.0', runtime: 'instruction-agent', manifest: { requestedCapabilities: [{ capability: 'web.search' }] }, manifestHash: 'a'.repeat(64), packagePath: 'C:/safe', sourceSnapshot: {}, isCompatible: true, createdAt: 2 }
const installation = { id: 'installation-1', packageId: 'package-1', currentVersionId: 'version-1', status: 'installed', enabled: true, installedAt: 2, updatedAt: 2 }

function deps() {
  return {
    legacy: { listInstalled: vi.fn(() => [legacySkill]), get: vi.fn((id: string) => id === legacySkill.id ? legacySkill : undefined), listRuns: vi.fn(() => [{ id: 'legacy-run' }]) },
    packages: {
      listPackages: vi.fn(() => ({ data: [packageRecord], total: 1 })),
      getPackage: vi.fn((id: string) => id === packageRecord.id ? packageRecord : undefined),
      listVersions: vi.fn(() => [version]),
      listInstallations: vi.fn(() => [installation]),
      getVersion: vi.fn(() => version),
      setInstallationEnabled: vi.fn((_id: string, enabled: boolean) => ({ ...installation, enabled })),
      deleteInstallation: vi.fn(() => true),
      isPackageReference: vi.fn(() => true),
    },
    legacyService: { remove: vi.fn(() => ({ kind: 'deleted' })), run: vi.fn(async () => ({ id: 'legacy-run' })) },
    startPackageRun: vi.fn(() => ({ runId: 'package-run' })),
  } as any
}

describe('skills facade', () => {
  it('lists both domains with explicit runtime metadata', () => {
    const facade = createSkillsFacade(deps())
    const result = facade.list({ limit: 10, offset: 0 })
    expect(result.data.map((item) => item.runtimeKind)).toEqual(['legacy', 'package'])
    expect(result.data[0]).toMatchObject({ reference: 'legacy:legacy-1', runtimeKind: 'legacy', lifecycle: 'read-only', readOnly: true, supportedActions: ['details', 'history', 'migration-preview'], capabilityProfile: { riskLevel: 'medium', canConvertToPackage: true } })
    expect(result.data[1]).toMatchObject({ reference: 'package:package-1', version: '1.2.0', capabilities: ['web.search'] })
  })

  it('routes package runs to the durable package starter and blocks Legacy runs', async () => {
    const dependencies = deps()
    const facade = createSkillsFacade(dependencies)
    await expect(facade.startRun('package:package-1', { q: 'x' })).resolves.toEqual({ runId: 'package-run' })
    await expect(facade.startRun('legacy:legacy-1', { q: 'x' })).rejects.toMatchObject({ code: 'LEGACY_SKILL_RUN_DISABLED' })
    expect(dependencies.startPackageRun).toHaveBeenCalledWith(expect.objectContaining({ skillVersionId: 'version-1' }))
    expect(dependencies.legacyService.run).not.toHaveBeenCalled()
  })

  it('keeps package lifecycle mutations in the Package plane and freezes Legacy uninstall', () => {
    const dependencies = deps()
    const facade = createSkillsFacade(dependencies)

    expect(facade.disable('package:package-1')).toMatchObject({ runtimeKind: 'package', enabled: true })
    expect(dependencies.packages.setInstallationEnabled).toHaveBeenCalledWith('installation-1', false)
    expect(facade.uninstall('package:package-1')).toEqual({ kind: 'uninstalled', reference: 'package:package-1' })
    expect(() => facade.uninstall('legacy:legacy-1')).toThrowError(expect.objectContaining({ code: 'LEGACY_SKILL_FROZEN' }))
    expect(dependencies.legacyService.remove).not.toHaveBeenCalled()
  })

  it('uses stable domain references and rejects unknown skills', () => {
    const facade = createSkillsFacade(deps())
    expect(() => facade.get('missing')).toThrowError(ServiceError)
  })
})
