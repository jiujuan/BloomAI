import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export type BaselineReferenceKind = 'import' | 'route' | 'schema/database' | 'test/fixture'
export type BaselineDisposition = 'delete' | 'migrate-retain' | 'audit-retain'

export type LegacyReference = {
  file: string
  line: number
  kind: BaselineReferenceKind
  match: string
  disposition: BaselineDisposition
  rationale: string
}

export type DependencyNode = {
  id: string
  type: 'file' | 'legacy-reference'
  file?: string
  kind?: BaselineReferenceKind
}

export type DependencyEdge = {
  from: string
  to: string
  kind: 'import' | 'legacy-reference'
}

export type SkillsBaseline = {
  schemaVersion: 'skills-admin-p0-baseline-v1'
  root: string
  filesScanned: number
  legacyReferences: LegacyReference[]
  dependencyGraph: {
    nodes: DependencyNode[]
    edges: DependencyEdge[]
  }
}

const SCAN_DIRECTORIES = [
  'src/renderer',
  'src/server/http/routes',
  'src/server/skills',
  'src/server/db',
  'tests',
  'scripts',
]

const TEXT_EXTENSIONS = new Set([
  '.cjs', '.css', '.html', '.js', '.json', '.mjs', '.md', '.mts', '.sql', '.ts', '.tsx', '.txt', '.yaml', '.yml',
])
const SKIP_DIRECTORIES = new Set([
  '.git', '.next', '.turbo', 'coverage', 'dist', 'dist-electron', 'node_modules', 'release', 'tmp', '.vite',
])

const LEGACY_SIGNAL = /(?:legacy(?:[-_ ]?(?:skill|skills|runtime|market|installed|run))?|legacySkill|LegacySkillsMarket|legacy-to-draft|skill_runs?\b)/i
const ROUTE_LITERAL = /['\"](?:\/api\/v\d+)?\/skills?(?:\/|['\"])/i
const IMPORT_SYNTAX = /^\s*import\b|^\s*export\s+(?:\*|\{)[^;]*\bfrom\b|\brequire\s*\(/i
const ROUTE_SYNTAX = /\b(?:app|router|route|routes)\s*\.\s*(?:get|post|put|patch|delete|all|use|route)\s*\(/i
const SCHEMA_SYNTAX = /(?:sqliteTable|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|skill_runs?\b)/i
const FIXTURE_PATH = /(?:^|[\\/])(?:tests?|__tests__|fixtures?|test-fixtures?)(?:[\\/]|$)|\.(?:test|spec)\.[^.]+$/i
const IMPORT_SPECIFIER = /\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g

function toPosix(value: string): string {
  return value.split(path.sep).join('/')
}

function normalizeRoot(root: string): string {
  return path.resolve(root)
}

function isTextFile(file: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())
}

function collectFiles(root: string): string[] {
  const files: string[] = []
  const visited = new Set<string>()
  const walk = (directory: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name.startsWith('.') && entry.isDirectory()) continue
      if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue
      const absolute = path.join(directory, entry.name)
      let stat: fs.Stats
      try {
        stat = fs.statSync(absolute)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        const real = path.resolve(absolute)
        if (visited.has(real)) continue
        visited.add(real)
        walk(absolute)
      } else if (stat.isFile() && isTextFile(absolute)) {
        files.push(absolute)
      }
    }
  }

  for (const directory of SCAN_DIRECTORIES) {
    const absolute = path.join(root, directory)
    if (fs.existsSync(absolute)) walk(absolute)
  }
  return files.sort((left, right) => toPosix(path.relative(root, left)).localeCompare(toPosix(path.relative(root, right))))
}

function relativeFile(root: string, file: string): string {
  return toPosix(path.relative(root, file))
}

function lineHasLegacySignal(file: string, line: string): boolean {
  return LEGACY_SIGNAL.test(line) || FIXTURE_PATH.test(file) && /legacy/i.test(line)
}

function isMigrationFile(file: string): boolean {
  return /(?:migration|migrate|legacy-to-draft|legacy-migration)/i.test(file)
}

function dispositionFor(kind: BaselineReferenceKind, file: string): { disposition: BaselineDisposition; rationale: string } {
  if (kind === 'schema/database' || isMigrationFile(file)) {
    return {
      disposition: 'migrate-retain',
      rationale: 'Legacy schema/data or offline migration references remain read-only until migration counts, backup, rollback, and explicit approval are complete.',
    }
  }
  if (kind === 'test/fixture') {
    return {
      disposition: 'audit-retain',
      rationale: 'Legacy test or fixture evidence is retained only for migration/audit verification and is not an input to the current Package Runtime catalog.',
    }
  }
  return {
    disposition: 'delete',
    rationale: 'Legacy UI, route, import, or runtime reference is scheduled for removal after Package Runtime replacement and P4 safety gates.',
  }
}

function classifyLine(file: string, line: string): BaselineReferenceKind[] {
  const kinds: BaselineReferenceKind[] = []
  const pathIsFixture = FIXTURE_PATH.test(file)
  const hasSignal = lineHasLegacySignal(file, line)
  if (hasSignal && IMPORT_SYNTAX.test(line)) kinds.push('import')
  if (hasSignal && (ROUTE_SYNTAX.test(line) || ROUTE_LITERAL.test(line))) kinds.push('route')
  if (hasSignal && SCHEMA_SYNTAX.test(line)) kinds.push('schema/database')
  if (line.trim() && ((pathIsFixture && hasSignal) || (hasSignal && /(?:fixture|test)/i.test(line)))) kinds.push('test/fixture')
  return kinds
}

function addImportEdges(root: string, files: string[], nodes: Map<string, DependencyNode>, edges: Map<string, DependencyEdge>): void {
  const knownFiles = new Set(files.map((file) => relativeFile(root, file)))
  const byWithoutExtension = new Map<string, string>()
  for (const relative of knownFiles) {
    const normalized = relative.replace(/\.(?:cjs|css|html|js|json|mjs|mts|sql|ts|tsx|txt|yaml|yml)$/i, '')
    byWithoutExtension.set(normalized, relative)
  }

  const resolveSpecifier = (fromFile: string, specifier: string): string | null => {
    if (!specifier.startsWith('.')) return null
    const fromDirectory = path.dirname(fromFile)
    const candidate = toPosix(path.normalize(path.join(fromDirectory, specifier)))
    const direct = knownFiles.has(candidate) ? candidate : byWithoutExtension.get(candidate)
    if (direct) return direct
    return [...knownFiles].find((file) => file.startsWith(`${candidate}/index.`)) ?? candidate
  }

  for (const absolute of files) {
    const from = relativeFile(root, absolute)
    const content = fs.readFileSync(absolute, 'utf8')
    for (const match of content.matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[1] ?? match[2]
      if (!specifier) continue
      const target = resolveSpecifier(from, specifier)
      if (!target) continue
      if (!nodes.has(target)) nodes.set(target, { id: target, type: 'file', file: target })
      const edgeKey = `${from}|${target}|import`
      edges.set(edgeKey, { from, to: target, kind: 'import' })
    }
  }
}

export function scanSkillsBaseline(inputRoot: string): SkillsBaseline {
  const root = normalizeRoot(inputRoot)
  const files = collectFiles(root)
  const references: LegacyReference[] = []
  const nodes = new Map<string, DependencyNode>()
  const edges = new Map<string, DependencyEdge>()

  for (const absolute of files) {
    const file = relativeFile(root, absolute)
    nodes.set(file, { id: file, type: 'file', file })
    const lines = fs.readFileSync(absolute, 'utf8').split(/\r?\n/)
    lines.forEach((line, index) => {
      for (const kind of classifyLine(file, line)) {
        const { disposition, rationale } = dispositionFor(kind, file)
        const reference: LegacyReference = {
          file,
          line: index + 1,
          kind,
          match: line.trim().slice(0, 400),
          disposition,
          rationale,
        }
        references.push(reference)
        const legacyId = `legacy:${kind}:${file}:${index + 1}:${reference.match}`
        nodes.set(legacyId, { id: legacyId, type: 'legacy-reference', kind })
        const edgeKey = `${file}|${legacyId}|legacy-reference`
        edges.set(edgeKey, { from: file, to: legacyId, kind: 'legacy-reference' })
      }
    })
  }

  addImportEdges(root, files, nodes, edges)

  references.sort((left, right) => left.file.localeCompare(right.file)
    || left.line - right.line
    || left.kind.localeCompare(right.kind)
    || left.match.localeCompare(right.match))
  const sortedNodes = [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id))
  const sortedEdges = [...edges.values()].sort((left, right) => left.from.localeCompare(right.from)
    || left.to.localeCompare(right.to)
    || left.kind.localeCompare(right.kind))

  return {
    schemaVersion: 'skills-admin-p0-baseline-v1',
    root,
    filesScanned: files.length,
    legacyReferences: references,
    dependencyGraph: { nodes: sortedNodes, edges: sortedEdges },
  }
}

function runCli(): void {
  const argument = process.argv.slice(2).find((value) => !value.startsWith('--'))
  const root = argument ?? process.cwd()
  process.stdout.write(`${JSON.stringify(scanSkillsBaseline(root), null, 2)}\n`)
}

const currentModule = pathToFileURL(fileURLToPath(import.meta.url)).href
const entryModule = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (currentModule === entryModule) runCli()
