import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { createSqlitePackageRepository } from '../../db/repositories/skill-package.repo'
import type { JsonObject, PackageSkillRepository, VersionSnapshot } from '../../skills/application/ports'
import { executeCapability, type CapabilityRequest, type CapabilityResult } from '../../skills/policy/capability-broker'
import { SkillPackageReader, type ReadAssetResult, type ReadTextResult } from '../../skills/packages/package-reader'

type MastraTool = ReturnType<typeof createTool>

type PackageFileMetadata = {
  readonly path: string
  readonly sizeBytes?: number
  readonly sha256?: string
}

export type MastraRunContext = {
  readonly runId: string
  readonly sessionId?: string
  readonly signal?: AbortSignal
}

export type MastraSkillSourceOptions = {
  readonly packages?: Pick<PackageSkillRepository, 'getVersion'>
  readonly executeCapability?: (request: CapabilityRequest) => Promise<CapabilityResult>
  readonly isCapabilityEnabled?: (capability: string, manifest: JsonObject) => boolean
  readonly readerOptions?: ConstructorParameters<typeof SkillPackageReader>[1]
}

export class MastraSkillSourceError extends Error {
  constructor(
    readonly code: 'SOURCE_NOT_FOUND' | 'SOURCE_INCOMPATIBLE' | 'SOURCE_INVALID',
    message: string,
  ) {
    super(message)
    this.name = 'MastraSkillSourceError'
  }
}

export type LoadedMastraSkillSource = {
  readonly skillVersionId: string
  readonly version: string
  readonly manifest: JsonObject
  readonly entryPath: string
  readonly reader: SkillPackageReader
  getInstructions(): string
  listReferences(): readonly PackageFileMetadata[]
  listAssets(): readonly PackageFileMetadata[]
  readText(relativePath: string, maxBytes?: number): ReadTextResult
  readAsset(relativePath: string, maxBytes?: number): ReadAssetResult
  createToolSet(runContext: MastraRunContext): Record<string, MastraTool>
}

/**
 * Adapter from the immutable Package Skill version snapshot to Mastra's
 * per-request instructions and tool surface. It deliberately has no install,
 * version, grant, queue, or audit responsibilities.
 */
export class MastraSkillSource {
  private readonly packages: Pick<PackageSkillRepository, 'getVersion'>
  private readonly executePackageCapability: (request: CapabilityRequest) => Promise<CapabilityResult>
  private readonly isCapabilityEnabled: (capability: string, manifest: JsonObject) => boolean
  private readonly readerOptions: ConstructorParameters<typeof SkillPackageReader>[1]

  constructor(options: MastraSkillSourceOptions = {}) {
    this.packages = options.packages ?? createSqlitePackageRepository()
    this.executePackageCapability = options.executeCapability ?? executeCapability
    this.isCapabilityEnabled = options.isCapabilityEnabled ?? (() => true)
    this.readerOptions = options.readerOptions ?? {}
  }

  load(skillVersionId: string): LoadedMastraSkillSource {
    const version = this.packages.getVersion(skillVersionId)
    if (!version) throw new MastraSkillSourceError('SOURCE_NOT_FOUND', `SkillVersion source not found: ${skillVersionId}`)
    if (!version.isCompatible || version.runtime !== 'instruction-agent') {
      throw new MastraSkillSourceError('SOURCE_INCOMPATIBLE', `SkillVersion is incompatible with Mastra: ${skillVersionId}`)
    }

    const manifest = freezeJson(cloneJson(version.manifest))
    const entryPath = manifestString(manifest.entryPath) ?? 'SKILL.md'
    let reader: SkillPackageReader
    try {
      reader = new SkillPackageReader(version.packagePath, this.readerOptions)
      // Fail during load rather than on the first model turn. The loaded object
      // then keeps this exact version and package snapshot for the whole run.
      reader.readText(entryPath)
    } catch (error) {
      throw new MastraSkillSourceError(
        'SOURCE_INVALID',
        `Unable to load SkillVersion source ${skillVersionId}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    const snapshot = new LoadedMastraSkillSourceImpl({
      skillVersionId,
      version: version.version,
      manifest,
      entryPath,
      reader,
      executePackageCapability: this.executePackageCapability,
      isCapabilityEnabled: this.isCapabilityEnabled,
    })
    return snapshot
  }
}

export function resolveInstructions(source: LoadedMastraSkillSource): string {
  return source.getInstructions()
}

export function createRunToolSet(
  source: LoadedMastraSkillSource,
  runContext: MastraRunContext,
): Record<string, MastraTool> {
  return source.createToolSet(runContext)
}

export function toPackageCapabilityToolId(capability: string): string {
  const normalized = capability.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
  return `package_capability_${normalized || 'unknown'}`
}

class LoadedMastraSkillSourceImpl implements LoadedMastraSkillSource {
  readonly skillVersionId: string
  readonly version: string
  readonly manifest: JsonObject
  readonly entryPath: string
  readonly reader: SkillPackageReader
  private readonly executePackageCapability: (request: CapabilityRequest) => Promise<CapabilityResult>
  private readonly isCapabilityEnabled: (capability: string, manifest: JsonObject) => boolean
  private readonly instructions: string
  private readonly references: readonly PackageFileMetadata[]
  private readonly assets: readonly PackageFileMetadata[]

  constructor(options: {
    skillVersionId: string
    version: string
    manifest: JsonObject
    entryPath: string
    reader: SkillPackageReader
    executePackageCapability: (request: CapabilityRequest) => Promise<CapabilityResult>
    isCapabilityEnabled: (capability: string, manifest: JsonObject) => boolean
  }) {
    this.skillVersionId = options.skillVersionId
    this.version = options.version
    this.manifest = options.manifest
    this.entryPath = options.entryPath
    this.reader = options.reader
    this.executePackageCapability = options.executePackageCapability
    this.isCapabilityEnabled = options.isCapabilityEnabled
    this.instructions = this.reader.readText(this.entryPath).content
    const metadata = manifestFileMetadata(this.manifest)
    this.references = selectFiles(this.manifest, 'references', metadata)
    this.assets = selectFiles(this.manifest, 'assets', metadata)
  }

  getInstructions(): string {
    return this.instructions
  }

  listReferences(): readonly PackageFileMetadata[] {
    return this.references
  }

  listAssets(): readonly PackageFileMetadata[] {
    return this.assets
  }

  readText(relativePath: string, maxBytes?: number): ReadTextResult {
    return this.reader.readText(relativePath, maxBytes)
  }

  readAsset(relativePath: string, maxBytes?: number): ReadAssetResult {
    return this.reader.readAsset(relativePath, maxBytes)
  }

  createToolSet(runContext: MastraRunContext): Record<string, MastraTool> {
    const tools: Record<string, MastraTool> = {}
    for (const capability of requestedCapabilities(this.manifest)) {
      if (!this.isCapabilityEnabled(capability, this.manifest)) continue
      const id = toPackageCapabilityToolId(capability)
      tools[id] = createTool({
        id,
        description: `Package Skill capability: ${capability}`,
        inputSchema: z.record(z.unknown()),
        outputSchema: z.record(z.unknown()),
        execute: async (input) => {
          const result = await this.executePackageCapability({
            caller: 'package-runtime',
            capability,
            input: input as Record<string, unknown>,
            runId: runContext.runId,
            ...(runContext.sessionId ? { sessionId: runContext.sessionId } : {}),
            ...(runContext.signal ? { signal: runContext.signal } : {}),
          })
          return result.output as Record<string, unknown>
        },
      })
    }
    return tools
  }
}

function requestedCapabilities(manifest: JsonObject): string[] {
  const value = manifest.requestedCapabilities ?? manifest.capabilities
  if (!Array.isArray(value)) return []
  return [...new Set(value.flatMap((entry) => {
    if (typeof entry === 'string') return [entry]
    if (entry && typeof entry === 'object' && typeof (entry as { capability?: unknown }).capability === 'string') {
      return [(entry as { capability: string }).capability]
    }
    return []
  }))]
}

function manifestFileMetadata(manifest: JsonObject): PackageFileMetadata[] {
  const files = manifest.files
  if (!Array.isArray(files)) return []
  return files.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const file = value as { path?: unknown; sizeBytes?: unknown; sha256?: unknown }
    if (typeof file.path !== 'string') return []
    return [{
      path: file.path,
      ...(typeof file.sizeBytes === 'number' ? { sizeBytes: file.sizeBytes } : {}),
      ...(typeof file.sha256 === 'string' ? { sha256: file.sha256 } : {}),
    }]
  })
}

function selectFiles(manifest: JsonObject, key: 'references' | 'assets', metadata: readonly PackageFileMetadata[]): readonly PackageFileMetadata[] {
  const declared = stringList(manifest[key])
  const prefix = `${key}/`
  const selected = declared.length
    ? metadata.filter((file) => declared.includes(file.path))
    : metadata.filter((file) => file.path.startsWith(prefix))
  return selected.length ? selected : declared.map((path) => ({ path }))
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : []
}

function manifestString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function cloneJson<T extends JsonObject>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function freezeJson<T>(value: T): T {
  if (!value || typeof value !== 'object') return value
  for (const child of Object.values(value as Record<string, unknown>)) freezeJson(child)
  return Object.freeze(value)
}
