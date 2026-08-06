import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PackageSkillRepository, VersionSnapshot } from '../../skills/application/ports'
import { MastraSkillSource, toPackageCapabilityToolId } from './mastra-skill-source'

let packagePath: string

function version(overrides: Partial<VersionSnapshot> = {}): VersionSnapshot {
  return {
    id: 'version-1',
    packageId: 'package-1',
    version: '1.0.0',
    runtime: 'instruction-agent',
    manifest: {
      name: 'Article Illustrator',
      entryPath: 'SKILL.md',
      requestedCapabilities: [
        { capability: 'web.search', scope: {} },
        { capability: 'image.generate', scope: {} },
      ],
      references: ['references/style.md'],
      assets: ['assets/logo.txt'],
      files: [
        { path: 'SKILL.md', sizeBytes: 42, sha256: 'entry-hash' },
        { path: 'references/style.md', sizeBytes: 20, sha256: 'reference-hash' },
        { path: 'assets/logo.txt', sizeBytes: 4, sha256: 'asset-hash' },
      ],
    },
    manifestHash: 'manifest-hash',
    packagePath,
    sourceSnapshot: {},
    isCompatible: true,
    createdAt: 1,
    ...overrides,
  }
}

describe('MastraSkillSource', () => {
  beforeEach(() => {
    packagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-mastra-source-'))
    fs.mkdirSync(path.join(packagePath, 'references'), { recursive: true })
    fs.mkdirSync(path.join(packagePath, 'assets'), { recursive: true })
    fs.writeFileSync(path.join(packagePath, 'SKILL.md'), '# Article Illustrator\nUse the reference style.\n')
    fs.writeFileSync(path.join(packagePath, 'references', 'style.md'), '# Style\nEditorial.\n')
    fs.writeFileSync(path.join(packagePath, 'assets', 'logo.txt'), 'logo')
  })

  afterEach(() => {
    fs.rmSync(packagePath, { recursive: true, force: true })
  })

  it('loads an immutable run source with instructions and reference/asset metadata', () => {
    const current = version()
    const packages = { getVersion: vi.fn(() => current) } as unknown as Pick<PackageSkillRepository, 'getVersion'>
    const source = new MastraSkillSource({ packages }).load('version-1')

    expect(source.skillVersionId).toBe('version-1')
    expect(source.getInstructions()).toContain('Use the reference style.')
    expect(source.listReferences()).toEqual([
      expect.objectContaining({ path: 'references/style.md', sha256: 'reference-hash' }),
    ])
    expect(source.listAssets()).toEqual([
      expect.objectContaining({ path: 'assets/logo.txt', sha256: 'asset-hash' }),
    ])

    Object.assign(current, { manifest: { ...current.manifest, name: 'mutated-after-load' } })
    expect(source.manifest.name).toBe('Article Illustrator')
  })

  it('fails closed when the selected source is missing or incompatible', () => {
    const packages = { getVersion: vi.fn(() => undefined) } as unknown as Pick<PackageSkillRepository, 'getVersion'>
    expect(() => new MastraSkillSource({ packages }).load('missing-version')).toThrow('SkillVersion source not found')

    const incompatible = { getVersion: vi.fn(() => version({ isCompatible: false })) } as unknown as Pick<PackageSkillRepository, 'getVersion'>
    expect(() => new MastraSkillSource({ packages: incompatible }).load('version-1')).toThrow('SkillVersion is incompatible')
  })

  it('creates isolated run-scoped capability tools and routes calls through the broker', async () => {
    const executeCapability = vi.fn(async (request) => ({
      capability: request.capability,
      toolId: 'web_search',
      toolRunId: request.runId,
      status: 'completed' as const,
      output: { runId: request.runId, query: request.input.query },
      artifactIds: [],
      usage: { calls: 1 },
      errorCode: null,
      retryable: false,
    }))
    const source = new MastraSkillSource({
      packages: { getVersion: vi.fn(() => version()) },
      executeCapability,
      isCapabilityEnabled: (capability) => capability !== 'image.generate',
    }).load('version-1')

    const toolsA = source.createToolSet({ runId: 'run-a', sessionId: 'session-a' })
    const toolsB = source.createToolSet({ runId: 'run-b', sessionId: 'session-b' })
    const searchToolId = toPackageCapabilityToolId('web.search')

    expect(Object.keys(toolsA)).toEqual([searchToolId])
    expect(Object.keys(toolsB)).toEqual([searchToolId])
    expect(toolsA).not.toBe(toolsB)

    const output = await (toolsA[searchToolId] as any).execute({ query: 'dawn' })
    expect(output).toEqual({ runId: 'run-a', query: 'dawn' })
    expect(executeCapability).toHaveBeenCalledWith(expect.objectContaining({
      caller: 'package-runtime',
      capability: 'web.search',
      runId: 'run-a',
      sessionId: 'session-a',
      input: { query: 'dawn' },
    }))
  })
})
