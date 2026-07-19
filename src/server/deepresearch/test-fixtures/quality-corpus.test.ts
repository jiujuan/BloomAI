import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ResearchRunDto } from '@shared/deepresearch/contracts'
import { extractMainContent } from '../domain/source-content'
import { SourceCurator } from '../../services/deepresearch/source-curator'

interface GoldenFixture {
  topic: string
  copyright: string
  queryContext: { queryId: string; questionId: string; question: string; plannedQuery: string; sourceTargets: string[]; needPrimarySource: boolean; needQuantitativeEvidence: boolean }
  candidates: Array<{ id: string; url: string; title: string; snippet: string; expectedCuration: 'selected' | 'not_relevant' | 'duplicate' }>
  documents: Array<{ candidateId: string; title: string; text: string; expectedRejection: string | null }>
  expectedConflicts: Array<{ left: string; right: string; candidateIds: string[] }>
}

const corpusPath = path.join(process.cwd(), 'src', 'server', 'deepresearch', 'test-fixtures', 'sales-lead-agent-quality.json')

function readFixture(): GoldenFixture {
  return JSON.parse(fs.readFileSync(corpusPath, 'utf8')) as GoldenFixture
}

function createRun(topic: string): ResearchRunDto {
  return {
    id: 'golden-sales-lead-agent', sessionId: null, topic, profile: 'market', depth: 'standard', status: 'researching', phase: 'researching', progress: 0, brief: null, workflowRunId: null,
    budget: { maxQuestions: 10, maxIterations: 2, maxSearchQueries: 20, maxNormalizedSources: 20, maxFetchedSources: 20, searchConcurrency: 1, fetchConcurrency: 1, maxDurationMs: 60_000 },
    usage: { questions: 1, iterations: 0, searchQueries: 1, normalizedSources: 0, fetchedSources: 0, tokens: 0, providerCostUsd: 0, startedAt: null, deadlineAt: null },
    quality: null, reportArtifactId: null, resumePhase: null, error: null, createdAt: 1, updatedAt: 1, completedAt: null,
  }
}

describe('sales-lead-agent golden fixture corpus', () => {
  it('ships a copyright-safe fixed corpus for source quality and content rejection regression coverage', () => {
    const fixture = readFixture()

    expect(fixture.copyright).toContain('synthetic')
    expect(fixture.candidates.map((candidate) => candidate.id)).toEqual(expect.arrayContaining([
      'official-product', 'official-documentation', 'industry-research', 'independent-research',
      'generic-news', 'duplicate-product', 'navigation-noise', 'captcha-page', 'short-page',
    ]))
    expect(fixture.expectedConflicts).toHaveLength(1)
  })

  it('curates primary and independent evidence while rejecting generic news and canonical duplicates', () => {
    const fixture = readFixture()
    const result = new SourceCurator().curate(
      createRun(fixture.topic),
      fixture.candidates.map((candidate) => ({ ...candidate, queryId: fixture.queryContext.queryId })),
      { queryContexts: { [fixture.queryContext.queryId]: fixture.queryContext } },
    )

    expect(result.selected.map((candidate) => fixture.candidates.find((entry) => entry.url === candidate.url)?.id)).toEqual(expect.arrayContaining([
      'official-product', 'official-documentation', 'industry-research', 'independent-research',
    ]))
    expect(result.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: fixture.candidates.find((entry) => entry.id === 'generic-news')!.url, reason: 'not_relevant' }),
      expect.objectContaining({ url: fixture.candidates.find((entry) => entry.id === 'duplicate-product')!.url, reason: 'duplicate' }),
    ]))
  })

  it('keeps valid fixture passages while blocking navigation, CAPTCHA, and short-page noise', () => {
    const fixture = readFixture()
    for (const document of fixture.documents) {
      const result = extractMainContent({
        finalUrl: fixture.candidates.find((candidate) => candidate.id === document.candidateId)!.url,
        title: document.title,
        text: document.text,
      })
      if (document.expectedRejection) {
        expect(result.rejectionReasons).toContain(document.expectedRejection)
      } else {
        expect(result.rejectionReasons).toEqual([])
        expect(result.content).toContain('sales')
      }
    }
  })

  it('preserves conflicting synthetic observations as separate source passages', () => {
    const fixture = readFixture()
    for (const conflict of fixture.expectedConflicts) {
      const text = fixture.documents
        .filter((document) => conflict.candidateIds.includes(document.candidateId))
        .map((document) => document.text)
        .join('\n')
      expect(text).toContain(conflict.left)
      expect(text).toContain(conflict.right)
    }
  })
})
