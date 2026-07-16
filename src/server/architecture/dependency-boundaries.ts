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

export type RouteDependencyBoundaryViolation = {
  file: string
  source: string
  reason: 'HTTP routes must call application services instead of repositories or runtimes'
}

type RouteSources = Record<string, string>
type RouteDirectoryOptions = { routesDirectory?: string }

const routesDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), '../http/routes')

/** Reports production-route imports that bypass the application service layer. */
export function findRouteDependencyBoundaryViolations(
  input: RouteSources | RouteDirectoryOptions = {},
): RouteDependencyBoundaryViolation[] {
  const sources = isRouteSources(input)
    ? input
    : readProductionRouteSources((input as RouteDirectoryOptions).routesDirectory ?? routesDirectory)

  return Object.entries(sources).flatMap(([file, content]) =>
    extractImportSources(content)
      .filter(isForbiddenRouteImport)
      .map((source) => ({
        file,
        source,
        reason: 'HTTP routes must call application services instead of repositories or runtimes' as const,
      })),
  )
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
