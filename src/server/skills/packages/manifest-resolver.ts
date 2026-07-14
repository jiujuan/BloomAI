import fs from 'fs'
import path from 'path'
import { load as loadYaml } from 'js-yaml'
import { skillCapabilitySchema, type CapabilityScope, type RequestedCapability } from '../policy/capability-policy'

const MAX_FRONTMATTER_BYTES = 256 * 1024
const SUPPORTED_ARTIFACT_TYPES = new Set(['markdown', 'json', 'prompt', 'image-reference', 'directory-manifest'])
const UNSUPPORTED_CAPABILITIES = new Set([
  'shell.execute',
  'python.execute',
  'dependency.install',
  'workspace.write',
  'home.read',
])

type FrontmatterValue = string | boolean | number | null | FrontmatterValue[] | { [key: string]: FrontmatterValue }
type Frontmatter = Record<string, FrontmatterValue>
type FrontmatterMapping = Record<string, FrontmatterValue> | Map<string, FrontmatterValue>

export type SkillManifest = {
  name: string
  description: string
  runtime: 'instruction-agent'
  entryPath: string
  compatible: boolean
  requestedCapabilities: RequestedCapability[]
  recommendedSurface?: string
  outputArtifactTypes: string[]
  references: string[]
  assets: string[]
  scripts: string[]
  unsupported: string[]
  unknownFrontmatter: Frontmatter
}

export class ManifestResolutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManifestResolutionError'
  }
}

export function resolveSkillManifest(packagePath: string, entryPath = 'SKILL.md'): SkillManifest {
  const root = path.resolve(packagePath)
  const normalizedEntryPath = normalizeEntryPath(entryPath)
  const entryFile = resolvePackageFile(root, normalizedEntryPath)
  const entryStat = fs.lstatSync(entryFile)
  if (!entryStat.isFile() || entryStat.isSymbolicLink()) throw new ManifestResolutionError(`Skill entry must be a regular file: ${normalizedEntryPath}`)

  const document = fs.readFileSync(entryFile, 'utf8')
  const { frontmatter, body } = splitFrontmatter(document)
  const unsupported = findUnsupportedDeclarations(frontmatter)
  const requestedCapabilities = resolveCapabilities(frontmatter.capabilities, unsupported)
  const packageFiles = collectPackageFiles(root)
  const references = packageFiles.filter((file) => file.startsWith('references/'))
  const assets = packageFiles.filter((file) => file.startsWith('assets/'))
  const scripts = packageFiles.filter((file) => file.startsWith('scripts/'))
  if (scripts.length) unsupported.push('scripts/')

  const runtimeValue = scalar(frontmatter.runtime)
  if (runtimeValue && runtimeValue !== 'instruction-agent') unsupported.push(`runtime:${runtimeValue}`)
  const outputArtifactTypes = normalizeStringList(frontmatter.output_artifacts ?? frontmatter.artifacts)
  for (const artifactType of outputArtifactTypes) {
    if (!SUPPORTED_ARTIFACT_TYPES.has(artifactType)) unsupported.push(`artifact:${artifactType}`)
  }

  const name = scalar(frontmatter.name) || firstHeading(body) || path.basename(root)
  const knownKeys = new Set([
    'name', 'description', 'runtime', 'capabilities', 'recommended_surface', 'surface',
    'output_artifacts', 'artifacts', 'entry_path', 'script', 'python', 'shell', 'mcp-plugin',
    'mcp_plugin', 'install_dependencies', 'dependency_install',
  ])
  const unknownFrontmatter = Object.fromEntries(Object.entries(frontmatter).filter(([key]) => !knownKeys.has(key)))

  return {
    name,
    description: scalar(frontmatter.description) || '',
    runtime: 'instruction-agent',
    entryPath: normalizedEntryPath,
    compatible: unsupported.length === 0,
    requestedCapabilities,
    recommendedSurface: scalar(frontmatter.recommended_surface ?? frontmatter.surface) || undefined,
    outputArtifactTypes,
    references,
    assets,
    scripts,
    unsupported: [...new Set(unsupported)],
    unknownFrontmatter,
  }
}

function splitFrontmatter(document: string): { frontmatter: Frontmatter; body: string } {
  const lines = document.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return { frontmatter: {}, body: document }
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closingIndex < 0) throw new ManifestResolutionError('SKILL.md frontmatter is missing its closing delimiter')
  const source = lines.slice(1, closingIndex).join('\n')
  if (Buffer.byteLength(source, 'utf8') > MAX_FRONTMATTER_BYTES) throw new ManifestResolutionError('SKILL.md frontmatter exceeds the maximum allowed size')
  try {
    const parsed = loadYaml(source)
    if (parsed === undefined || parsed === null) return { frontmatter: {}, body: lines.slice(closingIndex + 1).join('\n') }
    if (!isObject(parsed) || !isFrontmatterValue(parsed)) throw new ManifestResolutionError('SKILL.md frontmatter must be a YAML object')
    return { frontmatter: parsed, body: lines.slice(closingIndex + 1).join('\n') }
  } catch (error) {
    if (error instanceof ManifestResolutionError) throw error
    throw new ManifestResolutionError(`Invalid SKILL.md frontmatter: ${error instanceof Error ? error.message : 'YAML parsing failed'}`)
  }
}

function resolveCapabilities(value: FrontmatterValue | undefined, unsupported: string[]): RequestedCapability[] {
  const entries: Array<{ name: string; scope: CapabilityScope }> = []
  if (typeof value === 'string') entries.push({ name: value, scope: {} })
  else if (Array.isArray(value)) {
    for (const item of value) if (typeof item === 'string') entries.push({ name: item, scope: {} })
  }
  else if (isMapping(value)) {
    for (const [name, rawScope] of mappingEntries(value)) {
      if (rawScope === false) continue
      entries.push({ name, scope: isMapping(rawScope) ? normalizeScope(rawScope) : {} })
    }
  }

  const resolved: RequestedCapability[] = []
  for (const entry of entries) {
    if (UNSUPPORTED_CAPABILITIES.has(entry.name)) {
      unsupported.push(`capability:${entry.name}`)
      continue
    }
    const capability = skillCapabilitySchema.safeParse(entry.name)
    if (!capability.success) {
      unsupported.push(`capability:${entry.name}`)
      continue
    }
    if (!resolved.some((item) => item.capability === capability.data)) resolved.push({ capability: capability.data, scope: entry.scope })
  }
  return resolved
}

function normalizeScope(value: FrontmatterMapping): CapabilityScope {
  const stringArray = (key: string) => {
    const scopeValue = mappingGet(value, key)
    return Array.isArray(scopeValue) && scopeValue.every((item) => typeof item === 'string') ? scopeValue as string[] : undefined
  }
  const rawMaxCalls = mappingGet(value, 'maxCalls')
  const maxCalls = typeof rawMaxCalls === 'number' && Number.isInteger(rawMaxCalls) && rawMaxCalls > 0 ? rawMaxCalls : undefined
  return {
    ...(stringArray('allowedRoots') ? { allowedRoots: stringArray('allowedRoots') } : {}),
    ...(stringArray('allowedDomains') ? { allowedDomains: stringArray('allowedDomains') } : {}),
    ...(stringArray('allowedModels') ? { allowedModels: stringArray('allowedModels') } : {}),
    ...(maxCalls ? { maxCalls } : {}),
  }
}

function findUnsupportedDeclarations(frontmatter: Frontmatter): string[] {
  const unsupported: string[] = []
  for (const key of ['script', 'python', 'shell', 'mcp-plugin', 'mcp_plugin', 'install_dependencies', 'dependency_install']) {
    if (frontmatter[key] !== undefined && frontmatter[key] !== false) unsupported.push(key === 'mcp_plugin' ? 'mcp-plugin' : key)
  }
  return unsupported
}

function collectPackageFiles(root: string): string[] {
  const files: string[] = []
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name)
      const stat = fs.lstatSync(fullPath)
      if (stat.isSymbolicLink() || !stat.isDirectory() && !stat.isFile()) throw new ManifestResolutionError(`Package contains a non-regular file: ${fullPath}`)
      if (stat.isDirectory()) visit(fullPath)
      else files.push(path.relative(root, fullPath).split(path.sep).join('/'))
    }
  }
  visit(root)
  return files.sort()
}

function normalizeEntryPath(entryPath: string): string {
  const normalized = entryPath.replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) throw new ManifestResolutionError(`Unsafe skill entry path: ${entryPath}`)
  const pieces = normalized.split('/')
  if (pieces.some((piece) => !piece || piece === '.' || piece === '..')) throw new ManifestResolutionError(`Unsafe skill entry path: ${entryPath}`)
  return pieces.join('/')
}

function resolvePackageFile(root: string, relativePath: string): string {
  const resolved = path.resolve(root, ...relativePath.split('/'))
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new ManifestResolutionError(`Skill entry escapes package root: ${relativePath}`)
  if (!fs.existsSync(resolved)) throw new ManifestResolutionError(`Skill entry was not found: ${relativePath}`)
  return resolved
}

function normalizeStringList(value: FrontmatterValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : typeof value === 'string' ? [value] : []
}
function scalar(value: FrontmatterValue | undefined): string | undefined { return typeof value === 'string' ? value : undefined }
function firstHeading(body: string): string | undefined { return /^#\s+(.+)$/m.exec(body)?.[1]?.trim() || undefined }
function isObject(value: unknown): value is Record<string, FrontmatterValue> { return value !== null && !Array.isArray(value) && typeof value === 'object' }
function isMapping(value: unknown): value is FrontmatterMapping {
  return value instanceof Map || value !== null && typeof value === 'object' && !Array.isArray(value)
}
function mappingEntries(value: FrontmatterMapping): Array<[string, FrontmatterValue]> {
  return value instanceof Map ? [...value.entries()] : Object.entries(value)
}
function mappingGet(value: FrontmatterMapping, key: string): FrontmatterValue | undefined {
  return value instanceof Map ? value.get(key) : value[key]
}
function isFrontmatterValue(value: unknown): value is FrontmatterValue {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    || Array.isArray(value) && value.every(isFrontmatterValue)
    || value instanceof Map && [...value.values()].every(isFrontmatterValue)
    || !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(isFrontmatterValue)
}
