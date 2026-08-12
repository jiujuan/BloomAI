import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CapabilityGrant, PackageManifest, SkillInstallation, SkillVersion } from './skill-runtime.types'
import { buildSkillFileTree, buildSkillVersionDiff, getVersionSelection, getVersionState, SkillVersionPanel } from './SkillVersionPanel'
import { formatCapabilityScope, getCapabilityGrantState, SkillCapabilityPanel } from './SkillCapabilityPanel'
import { getVersionImpactSummary } from './SkillEditor'

const makeVersion = (id: string, version: string, files: Array<{ path: string; sha256: string; sizeBytes: number }>): SkillVersion => ({
  id,
  packageId: 'pkg-1',
  version,
  runtime: 'instruction-agent',
  manifest: { name: 'Research', description: 'Research skill', files },
  manifestHash: `${id}-manifest`,
  packagePath: `/packages/${id}`,
  sourceSnapshot: { sourceRef: version, files },
  isCompatible: true,
  status: 'runnable',
  securityStatus: 'verified',
  snapshotHash: `${id}-snapshot`,
  publishedAt: 100,
  createdAt: 100,
})

const current = makeVersion('v2', '2.0.0', [
  { path: 'SKILL.md', sha256: 'skill-v2', sizeBytes: 20 },
  { path: 'references/new.md', sha256: 'new', sizeBytes: 5 },
])
const history = makeVersion('v1', '1.0.0', [
  { path: 'SKILL.md', sha256: 'skill-v1', sizeBytes: 18 },
  { path: 'references/old.md', sha256: 'old', sizeBytes: 4 },
])
const installation: SkillInstallation = {
  id: 'install-1', packageId: 'pkg-1', currentVersionId: 'v2', status: 'active', enabled: true,
  installedAt: 100, updatedAt: 100, revision: 7,
}

const manifest: PackageManifest = {
  name: 'Research', description: 'Research skill', runtime: 'instruction-agent', entryPath: 'SKILL.md', compatible: true,
  requestedCapabilities: [{ capability: 'network.fetch', scope: { allowedDomains: ['example.com'], maxCalls: 10 } }],
  outputArtifactTypes: [], references: [], assets: [], scripts: [], unsupported: [], unknownFrontmatter: {},
}

const grant = {
  id: 'grant-1', skillVersionId: 'v2', capability: 'network.fetch', scope: { allowedDomains: ['example.com'], maxCalls: 10 },
  status: 'approved', grantMode: 'persistent', grantedBy: 'admin', grantedAt: 100,
} as CapabilityGrant

// Version/detail tests and retained capability-component tests are intentionally
// independent from public navigation: keeping SkillCapabilityPanel here does not
// restore a `permissions` view.

describe('P3-007 detail workflow and retained component contracts', () => {
  it('keeps the installation current version separate from a selected historical version', () => {
    const selection = getVersionSelection([history, current], installation.currentVersionId, history.id)
    expect(selection.current?.id).toBe('v2')
    expect(selection.selected?.id).toBe('v1')
    expect(getVersionState(history, selection.current?.id)).toBe('history')
    expect(getVersionState(current, selection.current?.id)).toBe('current')
  })

  it('returns an empty selection when there are no versions', () => {
    expect(getVersionSelection([], 'missing', 'missing')).toEqual({ current: undefined, selected: undefined })
  })

  it('builds a deterministic file tree and version diff', () => {
    const tree = buildSkillFileTree(current)
    expect(tree.map((node) => node.path)).toEqual(['SKILL.md', 'references'])
    expect(tree[1].children?.map((node) => node.path)).toEqual(['references/new.md'])
    expect(buildSkillVersionDiff(current, history)).toEqual({
      added: ['references/old.md'],
      removed: ['references/new.md'],
      changed: ['SKILL.md'],
    })
  })

  it('renders current/history labels, file tree and diff affordance', () => {
    const markup = renderToStaticMarkup(<SkillVersionPanel versions={[history, current]} currentVersionId="v2" selectedVersionId="v1" onSelect={() => undefined} />)
    expect(markup).toContain('当前版本')
    expect(markup).toContain('历史版本')
    expect(markup).toContain('文件树')
    expect(markup).toContain('Diff')
    expect(markup).toContain('references/old.md')
    expect(markup).not.toContain('v1 · current')
  })

  it('keeps Workbench detail focused on version content instead of Package Grant management', () => {
    const workbenchSource = readFileSync(new URL('./SkillsCenterWorkbench.tsx', import.meta.url), 'utf8')
    expect(workbenchSource).toContain("import { SkillVersionPanel } from './SkillVersionPanel'")
    expect(workbenchSource).toContain("tab === 'detail' && selectedPackage")
    expect(workbenchSource).toContain('<SkillVersionPanel')
    expect(workbenchSource).not.toContain("import { SkillCapabilityPanel } from './SkillCapabilityPanel'")
    expect(workbenchSource).not.toContain('<SkillCapabilityPanel')
    expect(workbenchSource).not.toContain('openGrantContext')
    expect(workbenchSource).not.toContain('selectedVersionGrants')
    expect(workbenchSource).not.toContain('approveGrant')
    expect(workbenchSource).not.toContain('rejectGrant')
  })

  it('removes Package Grant operations from Package Detail Drawer', () => {
    const drawerSource = readFileSync(new URL('./PackageDetailDrawer.tsx', import.meta.url), 'utf8')
    expect(drawerSource).toMatch(/import \{[^}]*SkillVersionPanel[^}]*\} from '\.\/SkillVersionPanel'/)
    expect(drawerSource).toContain('Installations')
    expect(drawerSource).toContain('最近 Runs')
    expect(drawerSource).toContain('Manifest')
    expect(drawerSource).not.toContain('SkillCapabilityPanel')
    expect(drawerSource).not.toContain('approveGrant')
    expect(drawerSource).not.toContain('rejectGrant')
    expect(drawerSource).not.toContain('revokeCapabilityGrant')
  })

  it('retains capability scope formatting and grant lifecycle contracts without requiring a permissions navigation view', () => {
    expect(formatCapabilityScope({ allowedDomains: ['example.com'], maxCalls: 10 })).toContain('允许域名：example.com')
    expect(formatCapabilityScope({ allowedRoots: ['C:/workspace'], maxCalls: 0 })).toContain('允许目录：C:/workspace')
    expect(formatCapabilityScope({})).toBe('未限定 scope')
    expect(getCapabilityGrantState(grant)).toBe('approved')
    expect(getCapabilityGrantState({ ...grant, revokedAt: 100, status: undefined })).toBe('revoked')
    const markup = renderToStaticMarkup(<SkillCapabilityPanel manifest={manifest} grants={[grant]} />)
    expect(markup).toContain('允许域名：example.com')
    expect(markup).toContain('persistent')
    expect(markup).toContain('当前版本')
  })

  it('explains update and rollback impact before a dangerous action', () => {
    expect(getVersionImpactSummary(current, history, 'rollback')).toMatchObject({
      actionLabel: '回滚',
      impact: expect.stringContaining('Installation'),
      risk: expect.stringContaining('当前版本'),
      requiresConfirmation: true,
    })
  })
})
