import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArtifactList } from './ArtifactList'
import { RunEventStream, mergeRunEvents } from './RunEventStream'
import type { SkillArtifact, SkillRunEvent } from './skill-runtime.types'

const makeEvent = (seq: number, payload: Record<string, unknown>): SkillRunEvent => ({
  id: `event-${seq}`, runId: 'run-e2e', seq, schemaVersion: 1, producer: 'server', type: 'output', payload, occurredAt: seq, createdAt: seq,
})

const imageArtifact: SkillArtifact = {
  id: 'artifact-e2e', runId: 'run-e2e', kind: 'image-reference', mimeType: 'image/png', path: 'out/result.png', sizeBytes: 1024,
  sha256: 'sha256:e2e', metadata: { imageSessionId: 'image-42', title: '<script>alert(1)</script>' }, createdAt: 1,
}

describe('Run Detail browser contract', () => {
  it('reconnects after refresh using the last sequence and preserves server event order', () => {
    const first = [makeEvent(1, { title: 'started' }), makeEvent(3, { title: 'completed' })]
    const afterSeq = mergeRunEvents(first, [makeEvent(2, { title: 'progress' }), makeEvent(3, { title: 'completed' })])
    expect(afterSeq.map((event) => event.seq)).toEqual([1, 2, 3])
    expect(renderToStaticMarkup(React.createElement(RunEventStream, { events: afterSeq }))).toContain('progress')
  })

  it('keeps Artifact preview safe and makes image-reference navigable to Image Studio', () => {
    const markup = renderToStaticMarkup(React.createElement(ArtifactList, { runId: 'run-e2e', artifacts: [imageArtifact], onExport: () => undefined }))
    expect(markup).toContain('image-session-42')
    expect(markup).toContain('image-studio')
    expect(markup).not.toContain('<script>alert(1)</script>')
  })
})
