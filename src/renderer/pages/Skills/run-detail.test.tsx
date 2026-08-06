import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArtifactList } from './ArtifactList'
import { CapabilityApprovalCard } from './CapabilityApprovalCard'
import { RunActionPanel } from './RunActionPanel'
import { RunEventStream, mergeRunEvents } from './RunEventStream'
import { RunTimeline } from './RunTimeline'
import type { SkillArtifact, SkillRun, SkillRunEvent } from './skill-runtime.types'

const run = {
  id: 'run-1',
  skillVersionId: 'version-1',
  status: 'waiting_approval',
  revision: 7,
  input: { topic: 'safe summary' },
  output: null,
  context: {},
  surface: 'skills',
  sessionId: null,
  imageSessionId: null,
  waitingReason: '需要批准 image.generate',
  waitingSince: 100,
  waitingExpiresAt: 200,
  requiredAction: {
    type: 'approval',
    grantId: 'grant-1',
    capability: 'image.generate',
    requestedScope: { allowedModels: ['image-1'] },
    grantedScope: {},
    risk: 'medium',
  },
  supportedActions: ['approve', 'reject', 'cancel'],
  version: { id: 'version-1', version: '1.2.0', source: 'github:acme/demo@abc123' },
  budget: { used: 2, limit: 5, unit: 'calls' },
  capabilityCalls: [{ id: 'call-1', capability: 'image.generate', status: 'waiting_approval', scope: { allowedModels: ['image-1'] } }],
  cancelRequested: false,
  startedAt: 90,
  updatedAt: 110,
  finishedAt: null,
  errorCode: null,
  errorMessage: null,
  resultSummary: null,
} as SkillRun

const event = (seq: number, id = `event-${seq}`, type = 'progress', payload: Record<string, unknown> = {}): SkillRunEvent => ({
  id, runId: 'run-1', seq, schemaVersion: 1, producer: 'worker', type, payload, occurredAt: seq, createdAt: seq,
})

const artifact = {
  id: 'artifact-1', runId: 'run-1', kind: 'image-reference', mimeType: 'image/png', path: 'images/result.png', sizeBytes: 2048,
  sha256: 'sha256:abc123', metadata: { imageSessionId: 'image-session-1', previewUrl: '/preview.png' }, createdAt: 120,
} satisfies SkillArtifact

describe('Run Detail workbench', () => {
  it('merges SSE and afterSeq events in sequence order without duplicate rendering', () => {
    const merged = mergeRunEvents([event(2), event(1)], [event(3), event(2, 'event-2-duplicate')])
    expect(merged.map((item) => item.seq)).toEqual([1, 2, 3])
    expect(new Set(merged.map((item) => item.id)).size).toBe(3)
    const markup = renderToStaticMarkup(<RunEventStream events={merged} />)
    expect((markup.match(/data-event-seq=/g) ?? []).length).toBe(3)
    expect(markup).not.toContain('dangerouslySetInnerHTML')
  })

  it('shows timeline, run metadata, budget, capability calls and approval details', () => {
    const markup = renderToStaticMarkup(<>
      <RunTimeline events={[event(1, 'event-1', 'run_started', { title: 'Run started' }), event(2, 'event-2', 'waiting_approval', { title: 'Approval required' })]} />
      <CapabilityApprovalCard action={run.requiredAction!} />
    </>)
    expect(markup).toContain('Run started')
    expect(markup).toContain('image.generate')
    expect(markup).toContain('allowedModels')
    expect(markup).toContain('medium')
  })

  it('offers server-declared approve/reject/cancel actions and safe waiting-input fields', () => {
    const approval = renderToStaticMarkup(<RunActionPanel run={run} onAction={() => undefined} />)
    expect(approval).toContain('批准')
    expect(approval).toContain('拒绝')
    expect(approval).toContain('取消')
    expect(approval).toContain('data-expected-revision="7"')

    const inputRun = { ...run, status: 'waiting_input', requiredAction: { type: 'input', fields: [{ name: 'topic', label: '主题', type: 'text', required: true }] }, supportedActions: ['submit_input', 'cancel'] } as SkillRun
    const input = renderToStaticMarkup(<RunActionPanel run={inputRun} onAction={() => undefined} />)
    expect(input).toContain('主题')
    expect(input).toContain('提交输入')
    expect(input).toContain('type="text"')
  })

  it('shows Artifact metadata, safe preview/export controls and Image Studio navigation', () => {
    const markup = renderToStaticMarkup(<ArtifactList runId="run-1" artifacts={[artifact]} onExport={() => undefined} />)
    expect(markup).toContain('image-reference')
    expect(markup).toContain('2.0 KB')
    expect(markup).toContain('sha256:abc123')
    expect(markup).toContain('预览')
    expect(markup).toContain('导出')
    expect(markup).toContain('image-session-1')
    expect(markup).not.toContain('<script')
  })
})
