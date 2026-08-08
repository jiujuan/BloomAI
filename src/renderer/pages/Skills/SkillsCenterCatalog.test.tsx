import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SkillListRow } from './SkillsCenterWorkbench'
import type { SkillRun } from './skill-runtime.types'
import { buildCatalogMetrics, getSkillStatusVisual, paginateCatalogRows, SkillsCenterCatalog } from './SkillOverviewPanel'

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
})
