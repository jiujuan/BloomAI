import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CapabilityGrant, PackageDetail, PackageManifest, SkillInstallation, SkillPackage, SkillRun, SkillVersion } from './skill-runtime.types'
import { CapabilityApprovalCard } from './CapabilityApprovalCard'
import { SkillCapabilityPanel } from './SkillCapabilityPanel'
import { SkillInstallationPanel, getInstallationState, installationStateLabel } from './SkillInstallationPanel'
import { SkillPermissionsPanel } from './SkillPermissionsPanel'

// These tests intentionally retain the lower-level Capability, Installation, and
// permissions-component contracts. They do not assert that `permissions` remains
// a public Skills navigation target; public approval is covered by Run Detail tests.

const grantBase: CapabilityGrant = {
  id: 'grant-1', skillVersionId: 'version-1', capability: 'network.fetch',
  scope: { allowedDomains: ['example.com'], maxCalls: 3 },
  requestedScope: { allowedDomains: ['example.com'], maxCalls: 3 },
  grantedScope: { allowedDomains: ['example.com'], maxCalls: 2 },
  status: 'requested', grantMode: 'persistent', grantedBy: null, grantedAt: null,
  expiresAt: Date.now() + 60_000, revokedAt: null, consumedAt: null,
}

const installation: SkillInstallation = {
  id: 'install-1', packageId: 'package-1', currentVersionId: 'version-1', status: 'active', enabled: true,
  installedAt: 100, updatedAt: 200, previousVersionId: 'version-0', revision: 7, rollbackReason: null,
}

const version: SkillVersion = {
  id: 'version-1', packageId: 'package-1', version: '1.2.0', runtime: 'instruction-agent',
  manifest: { name: 'Research', description: 'Research', requestedCapabilities: [], files: [] },
  manifestHash: 'manifest-1', packagePath: '/packages/package-1', sourceSnapshot: { sourceRef: 'main', files: [] },
  isCompatible: true, status: 'runnable', securityStatus: 'verified', snapshotHash: 'snapshot-1', publishedAt: 100, createdAt: 100,
}

const manifest: PackageManifest = {
  name: 'Research', description: 'Research', runtime: 'instruction-agent', entryPath: 'SKILL.md', compatible: true,
  requestedCapabilities: [{ capability: 'network.fetch', scope: grantBase.scope }], outputArtifactTypes: [], references: [], assets: [], scripts: [], unsupported: [], unknownFrontmatter: {},
}

const packageItem: SkillPackage = {
  id: 'package-1', name: 'Research', description: 'Research', sourceType: 'github', sourceUri: 'https://example.com/research', sourceRef: 'main',
  createdAt: 100, updatedAt: 200, deletedAt: null, deleteReason: null,
}

const detail: PackageDetail = { package: packageItem, versions: [version], installations: [installation], capabilityGrants: [grantBase] }

const waitingRun: SkillRun = {
  id: 'run-1', skillVersionId: 'version-1', status: 'waiting_approval', revision: 2, input: {}, output: null, context: {}, surface: 'skills', sessionId: null, imageSessionId: null,
  waitingReason: 'Capability approval required', waitingSince: 100, waitingExpiresAt: null, requiredAction: { type: 'capability_approval', grantId: 'grant-1', capability: 'network.fetch' },
  cancelRequested: false, startedAt: 100, updatedAt: 200, finishedAt: null, errorCode: null, errorMessage: null,
}

describe('P3-008 retained capability, installation and runtime contracts', () => {
  it('retains capability scope, budget, expiry and grant-action rendering', () => {
    const markup = renderToStaticMarkup(<SkillCapabilityPanel manifest={manifest} grants={[grantBase, { ...grantBase, id: 'grant-2', capability: 'filesystem.read', status: 'approved' }, { ...grantBase, id: 'grant-3', capability: 'shell.execute', status: 'revoked', revokedAt: 300 }]} onApprove={() => undefined} onReject={() => undefined} onRevoke={() => undefined} />)
    expect(markup).toContain('Pending Approval')
    expect(markup).toContain('Active Grants')
    expect(markup).toContain('Revoked / Closed')
    expect(markup).toContain('批准 Capability')
    expect(markup).toContain('允许域名：example.com')
    expect(markup).toContain('调用预算：3 次')
    expect(markup).toContain('有效期')
    expect(markup).toContain('撤销')
  })

  it('retains read-only capability rendering for operators without management permission', () => {
    const markup = renderToStaticMarkup(<SkillCapabilityPanel manifest={manifest} grants={[grantBase]} readOnly onApprove={() => undefined} onReject={() => undefined} onRevoke={() => undefined} />)
    expect(markup).toContain('只读')
    expect(markup).not.toContain('批准 Capability')
    expect(markup).not.toContain('拒绝 Capability')
  })

  it('retains Installation lifecycle states and dangerous action affordances', () => {
    expect(getInstallationState(installation)).toBe('active')
    expect(getInstallationState({ ...installation, enabled: false, status: 'disabled' })).toBe('disabled')
    expect(installationStateLabel('uninstalled')).toBe('已卸载')
    const markup = renderToStaticMarkup(<SkillInstallationPanel installations={[installation]} versions={[version]} onToggle={() => undefined} onRollback={() => undefined} onUninstall={() => undefined} />)
    expect(markup).toContain('Installations')
    expect(markup).toContain('v1.2.0')
    expect(markup).toContain('revision 7')
    expect(markup).toContain('禁用 Installation')
    expect(markup).toContain('回滚')
    expect(markup).toContain('卸载 Installation')
  })

  it('retains the permission component contract and exposes waiting runs without requiring public permissions navigation', () => {
    const markup = renderToStaticMarkup(<SkillPermissionsPanel detail={detail} installations={[installation]} runs={[waitingRun]} onApprove={() => undefined} onReject={() => undefined} onRevoke={() => undefined} onToggleInstallation={() => undefined} onRollbackInstallation={() => undefined} onUninstallInstallation={() => undefined} />)
    expect(markup).toContain('权限与安装')
    expect(markup).toContain('waiting_approval')
    expect(markup).toContain('来源 Run')
    expect(markup).toContain('Package Runtime')
  })

  it('retains the grant approval card contract with a safe requested scope', () => {
    const markup = renderToStaticMarkup(<CapabilityApprovalCard grant={grantBase} onApprove={() => undefined} onReject={() => undefined} />)
    expect(markup).toContain('批准 Capability')
    expect(markup).toContain('Grant ID')
    expect(markup).toContain('example.com')
    expect(markup).not.toContain('secret')
  })
})
