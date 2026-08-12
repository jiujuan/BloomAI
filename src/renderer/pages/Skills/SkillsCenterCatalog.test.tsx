import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SkillListRow } from './SkillsCenterWorkbench'
import type { SkillRun } from './skill-runtime.types'
import { buildCatalogMetrics, getCatalogTabCounts, getSkillStatusVisual, paginateCatalogRows, SkillsCenterCatalog } from './SkillOverviewPanel'

const packageRow = (overrides: Partial<SkillListRow> = {}): SkillListRow => ({
  id: 'pkg-1', kind: 'package', name: 'Research Analysis', description: 'Package skill', sourceLabel: 'Package · github', runtime: 'Package Runtime', version: '0.9.7', enabled: true,
  statusLabel: '已启用', statusTone: 'success', riskLabel: '低风险', riskTone: 'success', capabilities: ['web_search'], lastRunAt: 10,
  ...overrides,
})

const run = (overrides: Partial<SkillRun> = {}): SkillRun => ({
  id: 'run-1', skillVersionId: 'version-1', status: 'completed', revision: 1, input: {}, output: {}, context: {}, surface: 'skills', sessionId: null, imageSessionId: null,
  waitingReason: null, cancelRequested: false, startedAt: 1, updatedAt: 1, finishedAt: 1, errorCode: null, errorMessage: null, ...overrides,
})

describe('Skills Center Package Catalog', () => {
  it('uses icon, text and semantic tone for every catalog status', () => {
    expect(getSkillStatusVisual(packageRow({ statusLabel: '已启用', statusTone: 'success' }))).toMatchObject({ label: '已启用', tone: 'success' })
    expect(getSkillStatusVisual(packageRow({ statusLabel: '已禁用', statusTone: 'muted' }))).toMatchObject({ label: '已禁用', tone: 'muted' })
    expect(getSkillStatusVisual(packageRow({ statusLabel: '已隔离', statusTone: 'danger' }))).toMatchObject({ label: '已隔离', tone: 'danger' })
  })

  it('calculates KPI metrics from Package rows and runtime runs', () => {
    const metrics = buildCatalogMetrics([
      packageRow(),
      packageRow({ id: 'pkg-2', enabled: false, statusLabel: '已禁用', statusTone: 'muted' }),
    ], [run({ id: 'run-recent', updatedAt: 9 }), run({ id: 'run-waiting', status: 'waiting_approval', updatedAt: 8 })], 10)
    expect(metrics).toEqual({ totalSkills: 2, enabledSkills: 1, weeklyRuns: 2, pendingItems: 1 })
  })

  it('paginates catalog rows without changing the source list', () => {
    const rows = [packageRow(), packageRow({ id: 'pkg-2' }), packageRow({ id: 'pkg-3' })]
    expect(paginateCatalogRows(rows, 1, 2).map((row) => row.id)).toEqual(['pkg-3'])
    expect(rows).toHaveLength(3)
  })

  it('counts every catalog status tab from the complete package list', () => {
    const rows = [
      packageRow(),
      packageRow({ id: 'pkg-2', enabled: false, statusLabel: '未安装', statusTone: 'info', version: '未安装', installationId: undefined }),
      packageRow({ id: 'pkg-3', enabled: false, statusLabel: '待审批', statusTone: 'warning', run: run({ id: 'run-waiting', status: 'waiting_approval' }) }),
      packageRow({ id: 'pkg-4', enabled: false, statusLabel: '运行中', statusTone: 'info', run: run({ id: 'run-running', status: 'running' }) }),
      packageRow({ id: 'pkg-5', enabled: false, statusLabel: '失败', statusTone: 'danger', run: run({ id: 'run-failed', status: 'failed' }) }),
      packageRow({ id: 'pkg-6', enabled: false, statusLabel: '草稿', statusTone: 'warning', version: '0.1.0-draft' }),
      packageRow({ id: 'pkg-7', enabled: false, statusLabel: '已隔离', statusTone: 'danger', riskLabel: '隔离区', riskTone: 'danger' }),
    ]
    expect(getCatalogTabCounts(rows)).toEqual({ all: 7, enabled: 1, installed: 6, pending: 1, running: 1, failed: 1, draft: 1, quarantine: 1 })
  })

  it('renders the Package-only catalog with legend, KPI, recent runs and pending work', () => {
    const markup = renderToStaticMarkup(<SkillsCenterCatalog
      rows={[packageRow()]}
      runs={[run({ status: 'waiting_approval' })]}
      loading={false}
      error={null}
      page={0}
      pageSize={10}
      totalRows={1}
      onPageChange={() => undefined}
      onOpenPackage={() => undefined}
      onOpenRun={() => undefined}
      onOpenGrant={() => undefined}
    />)
    expect(markup).toContain('全部 Skills')
    expect(markup).toContain('已启用')
    expect(markup).toContain('本周 Runs')
    expect(markup).toContain('待处理事项')
    expect(markup).toContain('状态语言')
    expect(markup).toContain('最近运行')
    expect(markup).toContain('Pending Approval')
    expect(markup).toContain('Package Runtime')
    expect(markup).not.toContain('Legacy-only')
  })

  it('keeps the catalog title, tools and status tabs when the result list is empty', () => {
    const markup = renderToStaticMarkup(<SkillsCenterCatalog
      rows={[]}
      allRows={[]}
      runs={[]}
      loading={false}
      error={null}
      page={0}
      pageSize={10}
      totalRows={0}
      onPageChange={() => undefined}
      onOpenPackage={() => undefined}
      onOpenRun={() => undefined}
      onOpenGrant={() => undefined}
    />)
    expect(markup).toContain('Skill Catalog')
    expect(markup).toContain('0 个结果')
    expect(markup).toContain('搜索名称、Slug 或描述')
    expect(markup).toContain('最近更新')
    expect(markup).toContain('筛选')
    expect(markup).toContain('role="tablist"')
    for (const label of ['全部 Skills', '已启用', '已安装', '待审批', '运行中', '失败', '草稿', '隔离区']) {
      expect(markup).toContain(label)
    }
    expect(markup.indexOf('role="tablist"')).toBeGreaterThan(markup.indexOf('Skill Catalog'))
    expect(markup.indexOf('暂无 Package Skill')).toBeGreaterThan(markup.indexOf('role="tablist"'))
  })
})
