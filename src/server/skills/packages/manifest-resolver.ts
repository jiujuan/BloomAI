import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { load as loadYaml } from 'js-yaml'
import { z } from 'zod'
import { skillCapabilitySchema, type CapabilityScope, type RequestedCapability } from '../policy/capability-policy'
import { canonicalManifestSchema, type CanonicalSkillManifest, type ManifestDiagnostic, type ManifestValidationResult } from './manifest-schema'

const MAX_FRONTMATTER_BYTES = 256 * 1024
const MAX_MANIFEST_BYTES = 256 * 1024
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
  slug?: string
  version?: string
  license?: string
  author?: string
  packageFiles?: string[]
  compatibility?: Record<string, unknown>
  canonicalHash?: string
  diagnostics?: ManifestDiagnostic[]
}

export type PackageReaderLike = {
  listFiles(): string[]
  readText(relativePath: string, maxBytes?: number): { content: string } | string
}

export type ResolveManifestOptions = {
  entryPath?: string
  packageName?: string
}

export type ManifestResolution = {
  manifest: CanonicalSkillManifest
  legacyManifest: SkillManifest
  diagnostics: ManifestDiagnostic[]
  requiredCapabilities: RequestedCapability[]
  unsupportedCapabilities: string[]
  canonicalHash: string
}

export class ManifestResolutionError extends Error {
  readonly code = 'MANIFEST_INVALID'
  constructor(message: string) {
    super(message)
    this.name = 'ManifestResolutionError'
  }
}

export function resolveManifest(reader: PackageReaderLike, options: ResolveManifestOptions = {}): ManifestResolution {
  const files = stableUnique(reader.listFiles().map(normalizeRelativeFilePath))
  const entryPath = normalizeEntryPath(options.entryPath ?? findEntryPath(files))
  const entryContent = readReaderText(reader, entryPath, MAX_MANIFEST_BYTES)
  const { frontmatter, body } = splitFrontmatter(entryContent)
  const explicitManifest = readExplicitManifest(reader, files)
  const source = mergeManifestSources(frontmatter, explicitManifest)
  const unsupported = [...findUnsupportedDeclarations(source), ...normalizeStringList(source.unsupported)]
  const requestedCapabilities = resolveCapabilities(source.capabilities, unsupported)
  const outputArtifactTypes = normalizeStringList(source.output_artifacts ?? source.artifacts)
  for (const artifactType of outputArtifactTypes) {
    if (!SUPPORTED_ARTIFACT_TYPES.has(artifactType)) unsupported.push(`artifact:${artifactType}`)
  }

  const runtimeValue = scalar(source.runtime)
  if (runtimeValue && runtimeValue !== 'instruction-agent') unsupported.push(`runtime:${runtimeValue}`)
  const explicitEntry = scalar(source.entry ?? source.entry_path)
  const canonicalEntryPath = normalizeEntryPath(explicitEntry ?? entryPath)
  if (!files.includes(canonicalEntryPath)) unsupported.push(`entry:not_found:${canonicalEntryPath}`)
  if (canonicalEntryPath !== entryPath && files.includes(canonicalEntryPath)) {
    // The manifest may point at a document/template, but resolution still reads the declared SKILL.md entry.
    // Keep the canonical entry explicit while refusing executable-looking paths below.
  }
  if (isExecutableEntry(canonicalEntryPath)) unsupported.push(`entry:not_allowed:${canonicalEntryPath}`)

  const name = scalar(source.name) || firstHeading(body) || options.packageName || 'Unnamed Skill'
  const slug = scalar(source.slug) || slugify(name)
  const version = scalar(source.version) || '0.0.0-non-semver'
  const compatibility = isMapping(source.compatibility) ? toPlainObject(source.compatibility) : {}
  const extensions = isMapping(source.extensions) ? toPlainObject(source.extensions) : collectUnknownFrontmatter(source)
  const canonicalCandidate = {
    schemaVersion: 1,
    name,
    slug,
    version,
    description: scalar(source.description) || '',
    license: scalar(source.license),
    author: normalizeAuthor(source.author),
    entryPath: canonicalEntryPath,
    runtime: 'instruction-agent' as const,
    capabilities: requestedCapabilities,
    files: files.slice().sort(),
    compatibility,
    unsupported: stableUnique(unsupported),
    extensions,
  }
  const parsed = canonicalManifestSchema.safeParse(canonicalCandidate)
  const diagnostics = [...manifestParseDiagnostics(parsed), ...collectSemanticDiagnostics(canonicalCandidate as unknown as Partial<CanonicalSkillManifest>)]
  const canonicalManifest = parsed.success ? parsed.data : canonicalManifestSchema.parse({
    ...canonicalCandidate,
    name: name || 'Unnamed Skill',
    slug: slug || 'unnamed-skill',
    version: version || '0.0.0-non-semver',
  })
  const canonicalHash = canonicalManifestHash(canonicalManifest)
  const references = files.filter((file) => file.startsWith('references/'))
  const assets = files.filter((file) => file.startsWith('assets/'))
  const scripts = files.filter((file) => file.startsWith('scripts/'))
  if (scripts.length) unsupported.push('scripts/')
  const allUnsupported = stableUnique([...canonicalManifest.unsupported, ...unsupported])
  const legacyManifest: SkillManifest = {
    name: canonicalManifest.name,
    description: canonicalManifest.description,
    runtime: 'instruction-agent',
    entryPath: canonicalManifest.entryPath,
    compatible: diagnostics.every((item) => item.level !== 'error') && allUnsupported.length === 0,
    requestedCapabilities,
    recommendedSurface: scalar(source.recommended_surface ?? source.surface) || undefined,
    outputArtifactTypes,
    references,
    assets,
    scripts,
    unsupported: allUnsupported,
    unknownFrontmatter: collectUnknownFrontmatter(source),
    slug: canonicalManifest.slug,
    version: canonicalManifest.version,
    license: canonicalManifest.license,
    author: canonicalManifest.author,
    packageFiles: files,
    compatibility,
    canonicalHash,
    diagnostics,
  }

  return {
    manifest: { ...canonicalManifest, unsupported: allUnsupported },
    legacyManifest,
    diagnostics,
    requiredCapabilities: requestedCapabilities,
    unsupportedCapabilities: allUnsupported,
    canonicalHash,
  }
}

export function validateManifest(manifest: unknown): ManifestValidationResult {
  const parsed = canonicalManifestSchema.safeParse(manifest)
  if (!parsed.success) return { valid: false, errors: parsed.error.issues.map((issue) => ({ level: 'error', code: 'SCHEMA_INVALID', path: issue.path.join('.'), message: issue.message })), warnings: [] }
  const errors = collectSemanticDiagnostics(parsed.data).filter((item) => item.level === 'error')
  const warnings = collectSemanticDiagnostics(parsed.data).filter((item) => item.level === 'warning')
  return { valid: errors.length === 0, errors, warnings, manifest: parsed.data }
}

export function canonicalManifestHash(manifest: unknown): string {
  return crypto.createHash('sha256').update(canonicalJson(manifest)).digest('hex')
}

export function resolveSkillManifest(packagePath: string, entryPath = 'SKILL.md'): SkillManifest {
  const root = path.resolve(packagePath)
  const reader: PackageReaderLike = {
    listFiles: () => collectPackageFiles(root),
    readText: (relativePath, maxBytes = MAX_MANIFEST_BYTES) => {
      const normalized = normalizeEntryPath(relativePath)
      const fullPath = resolvePackageFile(root, normalized)
      const stat = fs.lstatSync(fullPath)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new ManifestResolutionError(`Skill entry must be a regular file: ${normalized}`)
      if (stat.size > maxBytes) throw new ManifestResolutionError(`Package file exceeds the maximum allowed size: ${normalized}`)
      return { content: fs.readFileSync(fullPath, 'utf8') }
    },
  }
  return resolveManifest(reader, { entryPath }).legacyManifest
}

function readExplicitManifest(reader: PackageReaderLike, files: string[]): Frontmatter {
  if (!files.includes('manifest.json')) return {}
  try {
    const raw = readReaderText(reader, 'manifest.json', MAX_MANIFEST_BYTES)
    const parsed: unknown = JSON.parse(raw)
    if (!isObject(parsed) || Array.isArray(parsed)) throw new ManifestResolutionError('manifest.json must contain a JSON object')
    if (!isFrontmatterValue(parsed)) throw new ManifestResolutionError('manifest.json contains unsupported values')
    return parsed
  } catch (error) {
    if (error instanceof ManifestResolutionError) throw error
    throw new ManifestResolutionError(`Invalid manifest.json: ${error instanceof Error ? error.message : 'JSON parsing failed'}`)
  }
}

function mergeManifestSources(frontmatter: Frontmatter, explicitManifest: Frontmatter): Frontmatter {
  // Explicit manifest is authoritative; frontmatter remains a compatibility fallback for older packages.
  return { ...frontmatter, ...explicitManifest }
}

function findEntryPath(files: string[]): string {
  if (files.includes('SKILL.md')) return 'SKILL.md'
  const candidates = files.filter((file) => path.posix.basename(file) === 'SKILL.md')
  if (candidates.length === 1) return candidates[0]
  throw new ManifestResolutionError('SKILL.md was not found in the package root')
}

function readReaderText(reader: PackageReaderLike, relativePath: string, maxBytes: number): string {
  const value = reader.readText(relativePath, maxBytes)
  return typeof value === 'string' ? value : value.content
}

function splitFrontmatter(document: string): { frontmatter: Frontmatter; body: string } {
  const lines = document.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return { frontmatter: {}, body: document }
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closingIndex < 0) throw new ManifestResolutionError('SKILL.md frontmatter is missing its closing delimiter')
  const source = lines.slice(1, closingIndex).join('\n')
  if (Buffer.byteLength(source, 'utf8') > MAX_FRONTMATTER_BYTES) throw new ManifestResolutionError('SKILL.md frontmatter exceeds the maximum allowed size')
  assertNoDuplicateTopLevelKeys(source)
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
  } else if (isMapping(value)) {
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
  return resolved.sort((a, b) => a.capability.localeCompare(b.capability))
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

function collectUnknownFrontmatter(frontmatter: Frontmatter): Frontmatter {
  const knownKeys = new Set([
    'name', 'slug', 'version', 'description', 'license', 'author', 'runtime', 'capabilities', 'recommended_surface', 'surface',
    'output_artifacts', 'artifacts', 'entry', 'entry_path', 'script', 'python', 'shell', 'mcp-plugin', 'mcp_plugin',
    'install_dependencies', 'dependency_install', 'files', 'compatibility', 'unsupported', 'extensions', 'schemaVersion',
  ])
  return Object.fromEntries(Object.entries(frontmatter).filter(([key]) => !knownKeys.has(key)))
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
  if (!normalized || normalized.includes('\0') || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) throw new ManifestResolutionError(`Unsafe skill entry path: ${entryPath}`)
  const pieces = normalized.split('/')
  if (pieces.some((piece) => !piece || piece === '.' || piece === '..')) throw new ManifestResolutionError(`Unsafe skill entry path: ${entryPath}`)
  return pieces.join('/')
}

function resolvePackageFile(root: string, relativePath: string): string {
  const resolved = path.resolve(root, ...relativePath.split('/'))
  if (!(resolved === root || resolved.startsWith(`${root}${path.sep}`))) throw new ManifestResolutionError(`Skill entry escapes package root: ${relativePath}`)
  if (!fs.existsSync(resolved)) throw new ManifestResolutionError(`Skill entry was not found: ${relativePath}`)
  return resolved
}

function normalizeStringList(value: FrontmatterValue | undefined): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : typeof value === 'string' ? [value] : [] }
function scalar(value: FrontmatterValue | undefined): string | undefined { return typeof value === 'string' ? value : undefined }
function firstHeading(body: string): string | undefined { return /^#\s+(.+)$/m.exec(body)?.[1]?.trim() || undefined }
function isObject(value: unknown): value is Record<string, FrontmatterValue> { return value !== null && !Array.isArray(value) && typeof value === 'object' }
function isMapping(value: unknown): value is FrontmatterMapping { return value instanceof Map || value !== null && typeof value === 'object' && !Array.isArray(value) }
function mappingEntries(value: FrontmatterMapping): Array<[string, FrontmatterValue]> { return value instanceof Map ? [...value.entries()] : Object.entries(value) }
function mappingGet(value: FrontmatterMapping, key: string): FrontmatterValue | undefined { return value instanceof Map ? value.get(key) : value[key] }
function isFrontmatterValue(value: unknown): value is FrontmatterValue {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    || Array.isArray(value) && value.every(isFrontmatterValue)
    || value instanceof Map && [...value.values()].every(isFrontmatterValue)
    || !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(isFrontmatterValue)
}
function normalizeAuthor(value: FrontmatterValue | undefined): string | undefined {
  if (typeof value === 'string') return value
  if (isMapping(value)) return scalar(mappingGet(value, 'name'))
  return undefined
}
function toPlainObject(value: FrontmatterMapping): Record<string, unknown> {
  return Object.fromEntries(mappingEntries(value).map(([key, item]) => [key, item instanceof Map ? toPlainObject(item) : isMapping(item) ? toPlainObject(item) : item]))
}
function slugify(value: string): string {
  const slug = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'unnamed-skill'
}
function stableUnique(values: string[]): string[] { return [...new Set(values)].sort((a, b) => a.localeCompare(b)) }
function normalizeRelativeFilePath(value: string): string {
  const normalized = value.replace(/\\/g, '/')
  if (!normalized || normalized.includes('\0') || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) throw new ManifestResolutionError(`Unsafe package file path: ${value}`)
  const pieces = normalized.split('/')
  if (pieces.some((piece) => !piece || piece === '.' || piece === '..')) throw new ManifestResolutionError(`Unsafe package file path: ${value}`)
  return pieces.join('/')
}
function isExecutableEntry(entryPath: string): boolean { return /(^|\/)(scripts?|bin|node_modules)(\/|$)|\.(?:js|mjs|cjs|ts|tsx|py|sh|bat|cmd|ps1)$/i.test(entryPath) }
function canonicalJson(value: unknown): Buffer { return Buffer.from(JSON.stringify(sortJson(value))) }
function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortJson(item)]))
  return value
}
function manifestParseDiagnostics(result: z.SafeParseReturnType<unknown, CanonicalSkillManifest>): ManifestDiagnostic[] {
  return result.success ? [] : result.error.issues.map((issue) => ({ level: 'error', code: 'SCHEMA_INVALID', path: issue.path.join('.'), message: issue.message }))
}
function collectSemanticDiagnostics(manifest: Partial<CanonicalSkillManifest>): ManifestDiagnostic[] {
  const diagnostics: ManifestDiagnostic[] = []
  if (manifest.version && manifest.version !== '0.0.0-non-semver' && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version)) diagnostics.push({ level: 'warning', code: 'NON_SEMVER_VERSION', path: 'version', message: 'Version is not strict SemVer and will be treated as non-semver.' })
  if (manifest.unsupported?.length) diagnostics.push(...manifest.unsupported.map((value) => ({ level: 'warning' as const, code: 'UNSUPPORTED_DECLARATION', path: 'unsupported', message: value })))
  for (const file of manifest.files ?? []) {
    if (file.length > 240) diagnostics.push({ level: 'error', code: 'PATH_TOO_LONG', path: 'files', message: `Package path is too long: ${file}` })
  }
  if (manifest.entryPath && isExecutableEntry(manifest.entryPath)) diagnostics.push({ level: 'error', code: 'ENTRY_NOT_ALLOWED', path: 'entryPath', message: 'Skill entry must be a document or template, not executable code.' })
  return diagnostics
}
function assertNoDuplicateTopLevelKeys(source: string): void {
  const seen = new Set<string>()
  for (const line of source.split(/\r?\n/)) {
    const match = /^(\s*)([A-Za-z_][\w-]*)\s*:/.exec(line)
    if (!match || match[1].length !== 0) continue
    if (seen.has(match[2])) throw new ManifestResolutionError(`Duplicate frontmatter field: ${match[2]}`)
    seen.add(match[2])
  }
}
