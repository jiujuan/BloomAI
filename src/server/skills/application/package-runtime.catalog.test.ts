import { describe, expect, it, vi } from 'vitest'
import { createPackageRuntimeCatalog } from './package-runtime.catalog'
import type { PackageSkillRepository } from './ports'

const packageRecord = {
  id: 'package-1',
  name: 'Package',
  description: 'Package Runtime package',
  sourceType: 'local-directory',
  sourceUri: null,
  sourceRef: null,
  createdAt: 1,
  updatedAt: 2,
}

const version = {
  id: 'version-1',
  packageId: 'package-1',
  version: '1.0.0',
  runtime: 'instruction-agent',
  manifest: {},
  manifestHash: 'a'.repeat(64),
  packagePath: 'C:/packages/package-1',
  sourceSnapshot: {},
  isCompatible: true,
  createdAt: 2,
}

const installation = {
  id: 'installation-1',
  packageId: 'package-1',
  currentVersionId: 'version-1',
  status: 'installed',
  enabled: true,
  installedAt: 2,
  updatedAt: 2,
}

function repository(): PackageSkillRepository {
  return {
    createPackage: vi.fn(() => packageRecord),
    getPackage: vi.fn((id) => id === packageRecord.id ? packageRecord : undefined),
    listPackages: vi.fn(() => ({ data: [packageRecord], total: 1 })),
    createVersion: vi.fn(() => version),
    getVersion: vi.fn((id) => id === version.id ? version : undefined),
    listVersions: vi.fn(() => [version]),
    createInstallation: vi.fn(() => installation),
    getInstallation: vi.fn(() => installation),
    setInstallationEnabled: vi.fn(() => installation),
    listInstallations: vi.fn(() => [installation]),
    deleteInstallation: vi.fn(() => false),
    resolveRunnableVersion: vi.fn(() => version),
    isPackageReference: vi.fn(() => true),
  }
}

describe('Package Runtime catalog facade', () => {
  it('routes Package/Version/Installation queries only through the Package repository', () => {
    const packages = repository()
    const catalog = createPackageRuntimeCatalog({ repository: packages })

    expect(catalog.listPackages({ limit: 20, offset: 0 })).toEqual({ data: [packageRecord], total: 1 })
    expect(catalog.getPackage('package-1')).toEqual(packageRecord)
    expect(catalog.listVersions('package-1')).toEqual([version])
    expect(catalog.getVersion('version-1')).toEqual(version)
    expect(catalog.listInstallations('package-1')).toEqual([installation])
    expect(catalog.resolveRunnableVersion('package-1')).toEqual(version)

    expect(packages.listPackages).toHaveBeenCalledOnce()
    expect(packages.getPackage).toHaveBeenCalledWith('package-1')
    expect(packages.listVersions).toHaveBeenCalledWith('package-1')
    expect(packages.getVersion).toHaveBeenCalledWith('version-1')
    expect(packages.listInstallations).toHaveBeenCalledWith('package-1')
    expect(packages.resolveRunnableVersion).toHaveBeenCalledWith('package-1')
  })

  it('does not expose a legacy repository or legacy mutation surface', () => {
    const catalog = createPackageRuntimeCatalog({ repository: repository() })
    expect(catalog).not.toHaveProperty('legacy')
    expect(catalog).not.toHaveProperty('create')
    expect(catalog).not.toHaveProperty('install')
    expect(catalog).not.toHaveProperty('run')
  })
})
