import { describe, expect, it } from 'vitest'
import type { ResearchEvidenceDto, ResearchSourceDto, ResearchSourceSnapshotDto } from '@shared/deepresearch/contracts'
import { getEvidenceSourceContext } from './research-source-context'

function source(id: string, title: string, domain: string): ResearchSourceDto {
  return {
    id,
    runId: 'run-1',
    canonicalUrl: 'https://' + domain + '/search-result',
    domain,
    title,
    author: null,
    publisher: null,
    publishedAt: null,
    sourceType: 'web',
    selectionStatus: 'selected',
    scores: {},
  }
}

function snapshot(id: string, sourceId: string, title: string, finalUrl: string): ResearchSourceSnapshotDto {
  return {
    id,
    runId: 'run-1',
    sourceId,
    contentHash: id,
    content: 'Source content.',
    metadata: { title },
    fetchedAt: 0,
    parserVersion: 'test',
    finalUrl,
    httpStatus: 200,
  }
}

function evidence(id: string, snapshotId: string): ResearchEvidenceDto {
  return {
    id,
    runId: 'run-1',
    questionId: 'question-1',
    snapshotId,
    passage: 'Evidence passage.',
    summary: 'Evidence summary.',
    stance: 'supporting',
    confidence: 0.9,
    startOffset: 0,
    endOffset: 17,
  }
}

describe('research evidence source context', () => {
  it('uses each fetched snapshot title and final URL instead of a generic search-result title', () => {
    const snapshotsById = {
      'snapshot-a': snapshot('snapshot-a', 'source-a', 'First primary-source report', 'https://first.example.org/report'),
      'snapshot-b': snapshot('snapshot-b', 'source-b', 'Second independent study', 'https://second.example.org/study'),
    }
    const sources = [
      source('source-a', 'Generic search result', 'first.example.org'),
      source('source-b', 'Generic search result', 'second.example.org'),
    ]

    expect(getEvidenceSourceContext(evidence('evidence-a', 'snapshot-a'), snapshotsById, sources)).toEqual({
      title: 'First primary-source report',
      href: 'https://first.example.org/report',
      domain: 'first.example.org',
    })
    expect(getEvidenceSourceContext(evidence('evidence-b', 'snapshot-b'), snapshotsById, sources)).toEqual({
      title: 'Second independent study',
      href: 'https://second.example.org/study',
      domain: 'second.example.org',
    })
  })

  it('falls back to the canonical source title and URL when fetched metadata is unavailable', () => {
    const item = evidence('evidence-a', 'snapshot-a')
    const snapshotsById = { 'snapshot-a': snapshot('snapshot-a', 'source-a', '', '') }
    const sources = [source('source-a', 'Canonical source title', 'canonical.example.org')]

    expect(getEvidenceSourceContext(item, snapshotsById, sources)).toEqual({
      title: 'Canonical source title',
      href: 'https://canonical.example.org/search-result',
      domain: 'canonical.example.org',
    })
  })
})
