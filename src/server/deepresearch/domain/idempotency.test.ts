import { describe, expect, it } from 'vitest'
import {
  canonicalizeResearchUrl,
  createEvidenceFingerprint,
  createIterationQueryFingerprint,
  createSnapshotFingerprint,
} from './idempotency'

describe('Deep Research iteration idempotency protocol', () => {
  it('derives query fingerprints from the durable iteration and semantic scope rather than an ordinal', () => {
    const input = {
      runId: 'run-1',
      iterationId: 'iteration-a',
      questionId: 'question-1',
      intent: 'search_primary',
      query: '  OpenAI   revenue 2025 ',
      profile: 'market' as const,
      timeScope: { from: '2025-01-01', to: '2025-12-31' },
      policyVersion: 'v2',
    }

    expect(createIterationQueryFingerprint(input)).toBe(createIterationQueryFingerprint({ ...input, query: 'openai revenue 2025' }))
    expect(createIterationQueryFingerprint(input)).not.toBe(createIterationQueryFingerprint({ ...input, iterationId: 'iteration-b' }))
    expect(createIterationQueryFingerprint(input)).not.toBe(createIterationQueryFingerprint({ ...input, profile: 'academic' }))
  })

  it('canonicalizes only safe URL equivalences while retaining meaningful query parameters', () => {
    expect(canonicalizeResearchUrl('HTTPS://WWW.Example.com:443/a?b=2&utm_source=x&a=1#section'))
      .toBe('https://example.com/a?a=1&b=2')
    expect(canonicalizeResearchUrl('https://example.com/a?ref=research&id=9'))
      .toBe('https://example.com/a?id=9')
  })

  it('uses content and passage hashes to reuse equivalent snapshots and evidence', () => {
    expect(createSnapshotFingerprint({ runId: 'run-1', sourceId: 'source-1', finalUrl: 'https://example.com/a', parserVersion: 'parser-v1', contentHash: 'same-content' }))
      .toBe(createSnapshotFingerprint({ runId: 'run-1', sourceId: 'source-2', finalUrl: 'https://example.com/b', parserVersion: 'parser-v1', contentHash: 'same-content' }))
    expect(createEvidenceFingerprint({ questionId: 'question-1', snapshotId: 'snapshot-1', startOffset: 0, endOffset: 32, passage: 'The same cited passage.' }))
      .toBe(createEvidenceFingerprint({ questionId: 'question-1', snapshotId: 'snapshot-1', startOffset: 0, endOffset: 32, passage: 'The same cited passage.' }))
  })
})