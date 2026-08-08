import React from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArtifactList } from './ArtifactList'
import { RunEventStream } from './RunEventStream'
import { RunsWorkbench, formatRunDuration, getRunArtifactCount, getRunStatusView } from './RunsWorkbench'
import { ArtifactsWorkbench } from './ArtifactsWorkbench'
import { SkillRuntimeSettingsPanel } from './SkillRuntimeSettingsPanel'
import { SkillsCenterWorkbench } from './SkillsCenterWorkbench'
import { RunActionPanel } from './RunActionPanel'
import { serializeRunEvents } from './RunDetailDrawer'
import type { SkillArtifact, SkillRun, SkillRunEvent, SkillRuntimeFeatureFlags, SkillRuntimeSettings } from './skill-runtime.types'

const skillsGlobalCss = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8')

const makeRun = (overrides: Partial<SkillRun> = {}) => ({
  id: 'run-1',
  skillVersionId: 'version-1',
  status: 'running',
  revision: 3,
  input: {},
  output: null,
  context: {},
  surface: 'skills',
  sessionId: null,
  imageSessionId: null,
  waitingReason: null,
  requiredAction: null,
  supportedActions: ['cancel'],
  version: { id: 'version-1', version: '1.2.0', source: 'github:acme/demo@abc123' },
  budget: null,
  capabilityCalls: [],
  inputSummary: null,
  outputSummary: null,
  cancelRequested: false,
  startedAt: 1_000,
  updatedAt: 6_000,
  finishedAt: null,
  errorCode: null,
  errorMessage: null,
  resultSummary: null,
  ...overrides,
}) as SkillRun

const artifact = {
  id: 'artifact-1',
  runId: 'run-1',
  kind: 'markdown',
  mimeType: 'text/markdown',
  path: 'reports/result.md',
  sizeBytes: 2_048,
  sha256: 'sha256:abc123',
  metadata: { previewText: '# Result', securityStatus: 'passed' },
  createdAt: 5_000,
} satisfies SkillArtifact

const event: SkillRunEvent = {
  id: 'event-1',
  runId: 'run-1',
  seq: 1,
  schemaVersion: 1,
  producer: 'worker',
  type: 'run_started',
  payload: { title: 'Run started' },
  occurredAt: 2_000,
  createdAt: 2_000,
}

describe('P3-009 Runs, Artifacts and Settings workflow', () => {
  it('normalizes run status labels and calculates duration and artifact counts', () => {
    expect(getRunStatusView('running').label).toBe('运行中')
    expect(getRunStatusView('waiting_approval').label).toBe('等待审批')
    expect(getRunStatusView('waiting_input').label).toBe('等待输入')
    expect(getRunStatusView('completed').label).toBe('成功')
    expect(getRunStatusView('failed').label).toBe('失败')
    expect(getRunStatusView('cancelled').label).toBe('已取消')
    expect(formatRunDuration(makeRun(), 6_000)).toBe('5 秒')
    expect(getRunArtifactCount('run-1', { 'run-1': [artifact] })).toBe(1)
  })

  it('renders filterable Runs columns and all canonical statuses', () => {
    const runs = [
      makeRun({ id: 'run-running', status: 'running' }),
      makeRun({ id: 'run-approval', status: 'waiting_approval' }),
      makeRun({ id: 'run-input', status: 'waiting_input' }),
      makeRun({ id: 'run-success', status: 'completed', finishedAt: 4_000 }),
      makeRun({ id: 'run-failed', status: 'failed', finishedAt: 4_000 }),
      makeRun({ id: 'run-cancelled', status: 'cancelled', finishedAt: 4_000 }),
    ]
    const markup = renderToStaticMarkup(<RunsWorkbench runs={runs} artifactCounts={{ 'run-success': 2 }} onOpenRun={() => undefined} />)
    expect(markup).toContain('按 Run ID、Skill、状态、来源筛选')
    expect(markup).toContain('Duration')
    expect(markup).toContain('Artifacts')
    expect(markup).toContain('运行中')
    expect(markup).toContain('等待审批')
    expect(markup).toContain('等待输入')
    expect(markup).toContain('成功')
    expect(markup).toContain('失败')
    expect(markup).toContain('已取消')
    expect(markup).toContain('data-run-id="run-success"')
  })

  it('serializes events for Export Events without HTML injection and exposes failed retry', () => {
    const exported = serializeRunEvents([event])
    expect(exported).toContain('"events"')
    expect(exported).toContain('run_started')
    expect(exported).not.toContain('dangerouslySetInnerHTML')
    const failedRun = makeRun({ status: 'failed', supportedActions: undefined })
    const markup = renderToStaticMarkup(<RunActionPanel run={failedRun} onAction={() => undefined} />)
    expect(markup).toContain('data-run-action="retry"')
  })

  it('exposes SSE connection state, reconnect and Export Events controls', () => {
    const markup = renderToStaticMarkup(<RunEventStream events={[event]} streamStatus="reconnecting" reconnectAttempts={2} streamError="连接中断" onReconnect={() => undefined} onExportEvents={() => undefined} />)
    expect(markup).toContain('reconnecting')
    expect(markup).toContain('连接中断')
    expect(markup).toContain('重新连接')
    expect(markup).toContain('Export Events')
  })

  it('shows Artifact source, run context, preview, security status and export', () => {
    const markup = renderToStaticMarkup(<ArtifactList runId="run-1" skillLabel="Research Package · v1.2.0" artifacts={[artifact]} onExport={() => undefined} />)
    expect(markup).toContain('来源 Skill')
    expect(markup).toContain('Research Package · v1.2.0')
    expect(markup).toContain('Run ID')
    expect(markup).toContain('run-1')
    expect(markup).toContain('创建时间')
    expect(markup).toContain('2.0 KB')
    expect(markup).toContain('扫描通过')
    expect(markup).toContain('预览')
    expect(markup).toContain('导出')
    expect(markup).not.toContain('dangerouslySetInnerHTML')
  })

  it('renders the all-run Artifact explorer with traceable source and navigation', () => {
    const markup = renderToStaticMarkup(<ArtifactsWorkbench records={[{ artifact, skillLabel: 'Research Package · v1.2.0' }]} onOpenRun={() => undefined} onExport={() => undefined} />)
    expect(markup).toContain('Artifacts')
    expect(markup).toContain('Research Package · v1.2.0')
    expect(markup).toContain('查看 Run')
    expect(markup).toContain('导出')
  })

  it('groups settings into Runtime, Import & Security, Artifacts and Feature Flags without compatibility controls', () => {
    const settings: SkillRuntimeSettings = {
      runtime: { workerConcurrency: 2, packageExecutionEnabled: true },
      import: { githubImportEnabled: true },
      security: { allowShell: false },
      artifacts: { retentionDays: 30 },
    }
    const flags: SkillRuntimeFeatureFlags = { runtimeEnabled: true, packageExecutionEnabled: true, creatorPublishEnabled: false }
    const markup = renderToStaticMarkup(<SkillRuntimeSettingsPanel settings={settings} featureFlags={flags} diagnostics={null} onSaveSettings={() => Promise.resolve(settings)} onSaveFeatureFlags={() => Promise.resolve(flags)} onRollback={() => Promise.resolve(settings)} />)
    expect(markup).toContain('Runtime')
    expect(markup).toContain('Import &amp; Security')
    expect(markup).toContain('Artifacts')
    expect(markup).toContain('Feature Flags')
    expect(markup).toContain('高风险开关默认关闭')
    expect(markup).not.toContain('Legacy')
  })

  it('routes Runs, Artifacts and Settings tabs to their dedicated workbenches', () => {
    const previousWindow = (globalThis as { window?: unknown }).window
    const windowMock = {
      location: { hash: '#skills/tab=runs' },
      history: { replaceState: () => undefined },
    }
    Object.defineProperty(globalThis, 'window', { configurable: true, value: windowMock })
    try {
      const runsMarkup = renderToStaticMarkup(<SkillsCenterWorkbench />)
      expect(runsMarkup).toContain('按 Run ID、Skill、状态、来源筛选')

      windowMock.location.hash = '#skills/tab=artifacts'
      const artifactsMarkup = renderToStaticMarkup(<SkillsCenterWorkbench />)
      expect(artifactsMarkup).toContain('浏览所有 Run 产物')

      windowMock.location.hash = '#skills/tab=settings'
      const settingsMarkup = renderToStaticMarkup(<SkillsCenterWorkbench />)
      expect(settingsMarkup).toContain('高风险开关默认关闭')
    } finally {
      if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window
      else Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow })
    }
  })


  it('ships the shared P3-009 table, event, artifact and settings styling hooks', () => {
    for (const selector of [
      '.skills-runs-workbench',
      '.skills-runs-filter-grid',
      '.skills-data-table',
      '.skills-run-hero',
      '.skills-run-kpi-grid',
      '.skills-event-stream-status',
      '.skills-event-stream-actions',
      '.skills-event-stream-error',
      '.skills-artifact-kv',
      '.skills-security-badge',
      '.skills-artifacts-workbench',
      '.skills-artifact-table',
      '.skills-settings-workbench',
      '.skills-settings-grid',
      '.skills-settings-group',
      '.skills-toggle-control',
      '.skills-settings-health',
    ]) {
      expect(skillsGlobalCss).toContain(selector)
    }
  })

})
