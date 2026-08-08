import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { SkillInstallation, SkillPackage } from './skill-runtime.types'
import { buildSkillRows } from './SkillsCenterWorkbench'
import { getCatalogActionDescriptors, SkillsCenterCatalog, shouldConfirmCatalogUninstall } from './SkillOverviewPanel'

const packageRow = {
  id: 'pkg-1', kind: 'package' as const, name: 'Research Analysis', description: 'Package skill', sourceLabel: 'Package · github', runtime: 'Package Runtime', version: '1.2.0', enabled: true,
  statusLabel: '已启用', statusTone: 'success' as const, riskLabel: '低风险', riskTone: 'success' as const, capabilities: ['web_search'], lastRunAt: null,
  installationId: 'installation-1', installationRevision: 7,
}

const packageItem: SkillPackage = {
  id: 'pkg-1', name: 'Research Analysis', description: 'Package skill', sourceType: 'github', sourceUri: 'https://github.com/acme/research', sourceRef: 'main',
  createdAt: 1, updatedAt: 2, deletedAt: null, deleteReason: null,
}

const installation: SkillInstallation = {
  id: 'installation-1', packageId: 'pkg-1', currentVersionId: 'version-1', status: 'active', enabled: true, installedAt: 1, updatedAt: 2, revision: 7,
}

describe('Skills Center inline catalog actions', () => {
  it('keeps the four actions in the documented order and changes the toggle action by state', () => {
    expect(getCatalogActionDescriptors(packageRow).map((action) => action.key)).toEqual(['detail', 'toggle', 'version', 'uninstall'])
    expect(getCatalogActionDescriptors(packageRow).map((action) => action.label)).toEqual(['查看详情', '禁用 Installation', '创建新版本', '卸载 Installation'])
    expect(getCatalogActionDescriptors({ ...packageRow, enabled: false, statusLabel: '已禁用', statusTone: 'muted' }).map((action) => action.label)).toEqual(['查看详情', '启用 Installation', '创建新版本', '卸载 Installation'])
    expect(getCatalogActionDescriptors(packageRow)[3]).toMatchObject({ danger: true })
  })

  it('renders four icon-only buttons with tooltip and keyboard-accessible attributes', () => {
    const markup = renderToStaticMarkup(<SkillsCenterCatalog
      rows={[packageRow]}
      runs={[]}
      loading={false}
      page={0}
      pageSize={10}
      totalRows={1}
      onPageChange={() => undefined}
      onOpenPackage={() => undefined}
      onOpenRun={() => undefined}
      onOpenGrant={() => undefined}
      onToggleInstallation={() => undefined}
      onCreateVersion={() => undefined}
      onUninstallInstallation={() => undefined}
    />)
    const actionMarkup = markup.match(/<td class="skills-center-actions">([\s\S]*?)<\/td>/)?.[1] || ''
    expect([...actionMarkup.matchAll(/aria-label="([^"]+)"/g)].map((match) => match[1])).toEqual(['查看详情', '禁用 Installation', '创建新版本', '卸载 Installation'])
    expect([...actionMarkup.matchAll(/title="([^"]+)"/g)].map((match) => match[1])).toEqual(['查看详情', '禁用 Installation', '创建新版本', '卸载 Installation'])
    expect([...actionMarkup.matchAll(/data-tooltip="([^"]+)"/g)].map((match) => match[1])).toEqual(['查看详情', '禁用 Installation', '创建新版本', '卸载 Installation'])
    expect(actionMarkup).toContain('skills-catalog-action-button danger')
    expect(actionMarkup).not.toContain('三点')
    expect(markup).not.toContain('Skill 操作')
  })

  it('requires exactly one explicit confirmation before uninstall', () => {
    const confirm = vi.fn((message: string) => Boolean(message))
    expect(shouldConfirmCatalogUninstall(packageRow, confirm)).toBe(true)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0][0]).toContain('Research Analysis')
    expect(shouldConfirmCatalogUninstall(packageRow, vi.fn(() => false))).toBe(false)
  })

  it('keeps installation id and revision available to action handlers', () => {
    expect(buildSkillRows([packageItem], [installation], []).find((row) => row.id === 'pkg-1')).toMatchObject({ installationId: 'installation-1', installationRevision: 7 })
  })
})
