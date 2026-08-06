import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PackageSkillRepository, VersionSnapshot } from '../../skills/application/ports'
import { MastraSkillSource, toPackageCapabilityToolId } from './mastra-skill-source'

vi.mock('../tools', () => ({
  buildAgentTools: vi.fn(() => ({ legacy_tool: { id: 'legacy_tool' } })),
}))
vi.mock('../workspace/project-workspace.factory', () => ({
  projectWorkspaceFactory: { getCached: vi.fn() },
}))

import { buildChatAgentTools, resolvePackageSkillRuntime } from '../chat-agent'

let packagePath: string

function createVersion(): VersionSnapshot {
  return {
    id: 'version-1',
    packageId: 'package-1',
    version: '1.0.0',
    runtime: 'instruction-agent',
    manifest: { name: 'runtime', requestedCapabilities: ['web.search'] },
    manifestHash: 'hash',
    packagePath,
    sourceSnapshot: {},
    isCompatible: true,
    createdAt: 1,
  }
}

describe('Mastra package run integration', () => {
  beforeEach(() => {
    packagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-mastra-run-'))
    fs.writeFileSync(path.join(packagePath, 'SKILL.md'), '# Run instructions')
  })

  afterEach(() => fs.rmSync(packagePath, { recursive: true, force: true }))

  it('injects a selected version into one request without adding Package Skills globally', () => {
    const source = new MastraSkillSource({
      packages: { getVersion: vi.fn(() => createVersion()) } as unknown as Pick<PackageSkillRepository, 'getVersion'>,
    })
    const values = new Map([
      ['skillVersionId', 'version-1'],
      ['runId', 'run-1'],
      ['sessionId', 'session-1'],
    ])
    const requestContext = { get: (key: string) => values.get(key) }

    const loaded = resolvePackageSkillRuntime(requestContext, source)
    expect(loaded?.getInstructions()).toContain('# Run instructions')

    const tools = buildChatAgentTools(requestContext, source)
    expect(Object.keys(tools)).toEqual(['legacy_tool', toPackageCapabilityToolId('web.search')])
  })

  it('does not create a Package tool surface without a durable run id', () => {
    const source = new MastraSkillSource({
      packages: { getVersion: vi.fn(() => createVersion()) } as unknown as Pick<PackageSkillRepository, 'getVersion'>,
    })
    const requestContext = { get: (key: string) => ({ skillVersionId: 'version-1', sessionId: 'session-1' } as Record<string, string>)[key] }
    expect(resolvePackageSkillRuntime(requestContext, source)).toBeUndefined()
    expect(Object.keys(buildChatAgentTools(requestContext, source))).toEqual(['legacy_tool'])
  })
})
