import { createSqlitePackageRepository } from '../../db/repositories/skill-package.repo'
import type {
  InstallationSnapshot,
  PackageSkillRepository,
  PackageSnapshot,
  Page,
  VersionSnapshot,
} from './ports'

export type PackageRuntimeCatalog = {
  listPackages(options: { limit: number; offset: number }): Page<PackageSnapshot>
  getPackage(id: string): PackageSnapshot | undefined
  listVersions(packageId: string): readonly VersionSnapshot[]
  getVersion(id: string): VersionSnapshot | undefined
  listInstallations(packageId: string): readonly InstallationSnapshot[]
  resolveRunnableVersion(referenceId: string): VersionSnapshot | undefined
}

type PackageRuntimeCatalogDependencies = {
  repository: PackageSkillRepository
}

/**
 * Package-only domain facade.
 *
 * This boundary deliberately has no Legacy repository dependency. The combined
 * `skillsFacade` remains available to the migration/read-only compatibility
 * surface, while Package Runtime code should use this facade or the
 * `PackageSkillRepository` port directly.
 */
export function createPackageRuntimeCatalog(
  overrides: Partial<PackageRuntimeCatalogDependencies> = {},
): PackageRuntimeCatalog {
  const dependencies: PackageRuntimeCatalogDependencies = {
    repository: createSqlitePackageRepository(),
    ...overrides,
  }

  return {
    listPackages(options) {
      return dependencies.repository.listPackages(options)
    },

    getPackage(id) {
      return dependencies.repository.getPackage(id)
    },

    listVersions(packageId) {
      return dependencies.repository.listVersions(packageId)
    },

    getVersion(id) {
      return dependencies.repository.getVersion(id)
    },

    listInstallations(packageId) {
      return dependencies.repository.listInstallations(packageId)
    },

    resolveRunnableVersion(referenceId) {
      return dependencies.repository.resolveRunnableVersion(referenceId)
    },
  }
}

export const packageRuntimeCatalog = createPackageRuntimeCatalog()
