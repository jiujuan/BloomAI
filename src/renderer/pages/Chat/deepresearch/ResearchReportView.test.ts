import { describe, expect, it } from 'vitest'
import type { ResearchCitationDto, ResearchEvidenceDto, ResearchSourceDto, ResearchSourceSnapshotDto } from '@shared/deepresearch/contracts'
import { buildReportReferences } from './ResearchReportView'

function evidence(id: string, snapshotId: string): ResearchEvidenceDto {
  return { id, runId: 'run-1', questionId: 'question-1', snapshotId, passage: 'Passage', summary: 'Summary', stance: 'supporting', confidence: 0.9, startOffset: 0, endOffset: 7 }
}

function citation(id: string, ordinal: number, evidenceId: string): ResearchCitationDto {
  return { id, runId: 'run-1', claimId: 'claim-1', evidenceId, entailmentStatus: 'supported', rationale: 'Supported.', ordinal }
}

const snapshotsById: Record<string, ResearchSourceSnapshotDto> = {
  'snapshot-a': { id: 'snapshot-a', runId: 'run-1', sourceId: 'source-a', contentHash: 'a', content: 'A', metadata: { title: 'Source A title' }, fetchedAt: 0, parserVersion: 'test', finalUrl: 'https://a.example.org/report', httpStatus: 200 },
  'snapshot-b': { id: 'snapshot-b', runId: 'run-1', sourceId: 'source-b', contentHash: 'b', content: 'B', metadata: { title: 'Source B title' }, fetchedAt: 0, parserVersion: 'test', finalUrl: 'https://b.example.org/study', httpStatus: 200 },
}

const sources: ResearchSourceDto[] = [
  { id: 'source-a', runId: 'run-1', canonicalUrl: 'https://a.example.org/search', domain: 'a.example.org', title: 'Generic title', author: null, publisher: null, publishedAt: null, sourceType: 'web', selectionStatus: 'selected', scores: {} },
  { id: 'source-b', runId: 'run-1', canonicalUrl: 'https://b.example.org/search', domain: 'b.example.org', title: 'Generic title', author: null, publisher: null, publishedAt: null, sourceType: 'web', selectionStatus: 'selected', scores: {} },
]

describe('report citation references', () => {
  it('follows citation → evidence → snapshot → source for each rendered reference', () => {
    const references = buildReportReferences(
      [citation('citation-b', 2, 'evidence-b'), citation('citation-a', 1, 'evidence-a')],
      { 'evidence-a': evidence('evidence-a', 'snapshot-a'), 'evidence-b': evidence('evidence-b', 'snapshot-b') },
      snapshotsById,
      sources,
    )

    expect(references.map((reference) => [reference.citation.ordinal, reference.context?.title, reference.context?.href, reference.context?.domain])).toEqual([
      [1, 'Source A title', 'https://a.example.org/report', 'a.example.org'],
      [2, 'Source B title', 'https://b.example.org/study', 'b.example.org'],
    ])
  })
})
