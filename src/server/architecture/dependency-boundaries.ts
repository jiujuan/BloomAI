import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FORBIDDEN_ROUTE_IMPORT_PREFIXES = [
  '../../db/repositories/',
  '../../llm',
  '../../mastra',
  '../../skills/',
  '../../attachments/',
] as const

const LEGACY_ROUTE_IMPORT_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  'article-illustrations.ts': [
    '../../skills/article-illustrations/article-source',
    '../../skills/article-illustrations/article-illustration.service',
  ],
  'attachments.ts': ['../../attachments/attachment-service'],
  'chat.ts': [
    '../../mastra',
    '../../mastra/agents/team',
    '../../mastra/memory',
    '../../mastra/agents/writer-prompt',
    '../../db/repositories/message.repo',
    '../../db/repositories/session.repo',
    '../../attachments/attachment-service',
  ],
  'skill-package-runtime.ts': [
    '../../db/repositories/skill-package.repo',
    '../../skills/artifacts',
    '../../skills/packages/package-installer',
    '../../skills/runtime',
    '../../skills/runtime/skill-run-coordinator',
  ],
  'skills.ts': [
    '../../db/repositories/skill.repo',
    '../../db/repositories/skill-package.repo',
    '../../skills/identifiers',
    '../../skills/legacy',
  ],
  'tools.ts': [
    '../../db/repositories/tool.repo',
    '../../skills/policy/capability-broker',
  ],
}

export type RouteDependencyBoundaryViolation = {
  file: string
  source: string
  reason: 'HTTP routes must call application services instead of repositories or runtimes'
}

type RouteSources = Record<string, string>
type RouteDirectoryOptions = { routesDirectory?: string }

const routesDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), '../http/routes')

/**
 * Reports production-route imports that bypass the service layer. The explicit
 * allowlist represents pre-existing debt and must shrink as migration phases land.
 */
export function findRouteDependencyBoundaryViolations(
  input: RouteSources | RouteDirectoryOptions = {},
): RouteDependencyBoundaryViolation[] {
  const sources = isRouteSources(input)
    ? input
    : readProductionRouteSources((input as RouteDirectoryOptions).routesDirectory ?? routesDirectory)

  return Object.entries(sources).flatMap(([file, content]) => {
    const allowedSources = new Set(LEGACY_ROUTE_IMPORT_ALLOWLIST[file] ?? [])
    return extractImportSources(content)
      .filter((source) => isForbiddenRouteImport(source) && !allowedSources.has(source))
      .map((source) => ({
        file,
        source,
        reason: 'HTTP routes must call application services instead of repositories or runtimes' as const,
      }))
  })
}

function isRouteSources(input: RouteSources | RouteDirectoryOptions): input is RouteSources {
  return Object.keys(input).length > 0 && !('routesDirectory' in input)
}

function readProductionRouteSources(directory: string): RouteSources {
  return Object.fromEntries(
    fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.includes('.test.') && !entry.name.includes('.e2e.'))
      .map((entry) => [entry.name, fs.readFileSync(path.join(directory, entry.name), 'utf8')]),
  )
}

function extractImportSources(content: string): string[] {
  return Array.from(content.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g), (match) => match[1])
}

function isForbiddenRouteImport(source: string): boolean {
  return FORBIDDEN_ROUTE_IMPORT_PREFIXES.some((prefix) => source === prefix || source.startsWith(prefix))
}
