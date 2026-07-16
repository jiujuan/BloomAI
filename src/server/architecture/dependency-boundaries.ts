import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type DependencyLayer = 'route' | 'repository' | 'service'

export type DependencyBoundaryViolation = {
  layer: DependencyLayer
  file: string
  source: string
  reason: string
}

export type DependencyBoundaryAllowance = {
  layer: DependencyLayer
  file: string
  source: string
  /** Why this dependency is still required. */
  reason: string
  /** Team or role accountable for removing the exception. */
  owner: string
  /** Named migration phase or milestone when the exception will be removed. */
  removeByPhase: string
}

type BoundaryCheckInput = {
  layer: DependencyLayer
  sources: Record<string, string>
  allowlist?: readonly DependencyBoundaryAllowance[]
}

type ProductionBoundaryCheckOptions = {
  serverDirectory?: string
  allowlist?: readonly DependencyBoundaryAllowance[]
}

type BoundaryRule = {
  forbiddenImportPaths: readonly string[]
  reason: string
}

const BOUNDARY_RULES: Record<DependencyLayer, BoundaryRule> = {
  route: {
    forbiddenImportPaths: [
      'db/repositories',
      'llm',
      'mastra',
      'skills',
      'attachments',
    ],
    reason: 'HTTP routes must call application services instead of repositories or runtimes',
  },
  repository: {
    forbiddenImportPaths: [
      'services',
      'http',
      'llm',
      'mastra',
      'skills',
      'attachments',
    ],
    reason: 'Repositories must only depend on persistence code, not services, HTTP, or runtimes',
  },
  service: {
    forbiddenImportPaths: [
      'http/routes',
      'hono',
    ],
    reason: 'Application services must not depend on HTTP routes or Hono',
  },
}

/**
 * Temporary exceptions must be added here with a reason, accountable owner, and removal phase.
 * Keep this list empty unless an unavoidable migration dependency has a scheduled removal.
 */
export const DEPENDENCY_BOUNDARY_ALLOWLIST = [] as const satisfies readonly DependencyBoundaryAllowance[]

const defaultServerDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Reports imports that cross a forbidden server-layer boundary. */
export function findDependencyBoundaryViolations({
  layer,
  sources,
  allowlist = DEPENDENCY_BOUNDARY_ALLOWLIST,
}: BoundaryCheckInput): DependencyBoundaryViolation[] {
  validateAllowlist(allowlist)
  const rule = BOUNDARY_RULES[layer]

  return Object.entries(sources).flatMap(([file, content]) =>
    extractImportSources(content)
      .filter((source) => isForbiddenImport(source, rule))
      .filter((source) => !isAllowlisted({ layer, file, source }, allowlist))
      .map((source) => ({ layer, file, source, reason: rule.reason })),
  )
}

/** Reports boundary violations across every production HTTP Route, Service, and Repository. */
export function findProductionDependencyBoundaryViolations({
  serverDirectory = defaultServerDirectory,
  allowlist = DEPENDENCY_BOUNDARY_ALLOWLIST,
}: ProductionBoundaryCheckOptions = {}): DependencyBoundaryViolation[] {
  return [
    ...findDependencyBoundaryViolations({
      layer: 'route',
      sources: readProductionSources(path.join(serverDirectory, 'http/routes')),
      allowlist,
    }),
    ...findDependencyBoundaryViolations({
      layer: 'service',
      sources: readProductionSources(path.join(serverDirectory, 'services')),
      allowlist,
    }),
    ...findDependencyBoundaryViolations({
      layer: 'repository',
      sources: readProductionSources(path.join(serverDirectory, 'db/repositories')),
      allowlist,
    }),
  ]
}

/** @deprecated Use findDependencyBoundaryViolations with layer: 'route'. */
export function findRouteDependencyBoundaryViolations(sources: Record<string, string> = {}): DependencyBoundaryViolation[] {
  return findDependencyBoundaryViolations({ layer: 'route', sources })
}

function validateAllowlist(allowlist: readonly DependencyBoundaryAllowance[]): void {
  for (const [index, allowance] of allowlist.entries()) {
    for (const field of ['file', 'source', 'reason', 'owner', 'removeByPhase'] as const) {
      if (!allowance[field]?.trim()) {
        throw new Error(`Dependency-boundary allowlist entry ${index} must declare a non-empty ${field}`)
      }
    }
  }
}

function readProductionSources(directory: string): Record<string, string> {
  return Object.fromEntries(readProductionFiles(directory).map((filePath) => [
    path.relative(directory, filePath).replaceAll(path.sep, '/'),
    fs.readFileSync(filePath, 'utf8'),
  ]))
}

function readProductionFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return readProductionFiles(entryPath)
    return isProductionSourceFile(entry.name) ? [entryPath] : []
  })
}

function isProductionSourceFile(fileName: string): boolean {
  return fileName.endsWith('.ts')
    && !fileName.endsWith('.d.ts')
    && !fileName.includes('.test.')
    && !fileName.includes('.e2e.')
    && !fileName.includes('.spec.')
}

function extractImportSources(content: string): string[] {
  const staticImports = Array.from(
    content.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g),
    (match) => match[1],
  )
  const dynamicImports = Array.from(content.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g), (match) => match[1])
  return [...new Set([...staticImports, ...dynamicImports])]
}

function isForbiddenImport(source: string, rule: BoundaryRule): boolean {
  const importPath = source.replace(/^(?:\.\.\/)+/, '')
  return rule.forbiddenImportPaths.some((forbiddenPath) =>
    importPath === forbiddenPath || importPath.startsWith(`${forbiddenPath}/`),
  )
}

function isAllowlisted(
  violation: Pick<DependencyBoundaryViolation, 'layer' | 'file' | 'source'>,
  allowlist: readonly DependencyBoundaryAllowance[],
): boolean {
  return allowlist.some((allowance) =>
    allowance.layer === violation.layer
    && allowance.file === violation.file
    && allowance.source === violation.source,
  )
}
