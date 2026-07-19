import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  ResearchBriefDto,
  ResearchCitationDto,
  ResearchClaimDto,
  ResearchEvidenceDto,
  ResearchQuestionDto,
  ResearchReportSectionDto,
  ResearchRunDto,
  ResearchSourceDto,
  ResearchSourceSnapshotDto,
} from '@shared/deepresearch/contracts'
import { ArtifactService, createReportMarkdown } from './artifact-service'
import { CitationService } from './citation-service'
import { assessReportQuality } from '@server/mastra/deepresearch/steps/assess-quality'
import { DEFAULT_RESEARCH_QUALITY_GATE_POLICY } from '@server/deepresearch/domain/quality-policy'

const runId = 'run-a'
const otherRunId = 'run-b'
const now = Date.now()
const createdDirectories: string[] = []

function createRun(overrides: Partial<ResearchRunDto> = {}): ResearchRunDto {
  return {
    id: runId,
    sessionId: null,
    topic: 'Enterprise AI assistant market',
    profile: 'market',
    depth: 'deep',
    status: 'verifying',
    phase: 'report_verification',
    progress: 90,
    brief: null,
    workflowRunId: null,
    budget: {
      maxQuestions: 14,
      maxIterations: 3,
      maxSearchQueries: 48,
      maxNormalizedSources: 50,
      maxFetchedSources: 36,
      searchConcurrency: 6,
      fetchConcurrency: 5,
      maxDurationMs: 30 * 60 * 1000,
    },
    usage: {
      questions: 1,
      iterations: 1,
      searchQueries: 3,
      normalizedSources: 3,
      fetchedSources: 3,
      tokens: 0,
      providerCostUsd: 0,
      startedAt: now,
      deadlineAt: now + 30 * 60 * 1000,
    },
    quality: null,
    reportArtifactId: null,
    resumePhase: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    ...overrides,
  }
}

function createQuestion(overrides: Partial<ResearchQuestionDto> = {}): ResearchQuestionDto {
  return {
    id: 'question-a',
    runId,
    parentQuestionId: null,
    ordinal: 1,
    question: 'What is the market size?',
    intent: 'market-sizing',
    requiredEvidenceTypes: [],
    priority: 'high',
    status: 'covered',
    coverage: {
      questionId: 'question-a',
      score: 0.8,
      independentDomainCount: 3,
      evidenceCategories: ['official-statistics'],
      primarySourceCount: 3,
      recentSourceCount: 3,
      supportingEvidenceCount: 3,
      contradictingEvidenceCount: 0,
      hasSingleSourceDependency: false,
      gaps: [],
    },
    ...overrides,
  }
}

function createEvidence(id: string, sourceId: string, overrides: Partial<ResearchEvidenceDto> = {}): ResearchEvidenceDto {
  return {
    id,
    runId,
    questionId: 'question-a',
    snapshotId: 'snapshot-' + sourceId,
    passage: 'The independently published source describes a measured market observation with enough context to be cited in a formal research report.',
    summary: 'Independent source evidence.',
    stance: 'supporting',
    confidence: 0.9,
    startOffset: 0,
    endOffset: 120,
    ...overrides,
  }
}

function createSource(id: string, domain: string): ResearchSourceDto {
  return {
    id,
    runId,
    canonicalUrl: 'https://' + domain + '/research',
    domain,
    title: domain + ' research',
    author: null,
    publisher: domain,
    publishedAt: now,
    sourceType: 'official-statistics',
    selectionStatus: 'selected',
    scores: {},
  }
}

function createSection(id: string, title: string, ordinal: number): ResearchReportSectionDto {
  const uniqueDetail = Array.from({ length: 28 }, (_, index) => title.replace(/[^a-z0-9]/gi, '') + 'evidence' + index).join(' ')
  return {
    id,
    runId,
    ordinal,
    title,
    purpose: title,
    draft: title + ' draft',
    verifiedText: title + ' verified text. This section develops a distinct evidence-backed conclusion with scope, conditions, source provenance, and explicit uncertainty. ' + uniqueDetail,
    status: 'verified',
  }
}

function createClaim(id: string, sectionId: string, overrides: Partial<ResearchClaimDto> = {}): ResearchClaimDto {
  return {
    id,
    runId,
    sectionId,
    text: 'The market evidence supports this factual claim.',
    kind: 'factual',
    importance: 'high',
    verificationStatus: 'supported',
    confidence: 0.9,
    repairHistory: [],
    ...overrides,
  }
}

function createCitation(id: string, claimId: string, evidenceId: string, overrides: Partial<ResearchCitationDto> = {}): ResearchCitationDto {
  return {
    id,
    runId,
    claimId,
    evidenceId,
    entailmentStatus: 'supported',
    rationale: 'The evidence directly supports the claim.',
    verificationMethod: 'semantic_llm',
    semanticChecks: { entity: 'supported', numericTemporal: 'not_applicable', relationship: 'supported', stance: 'supported' },
    ordinal: 1,
    ...overrides,
  }
}

function createRequiredSections(): ResearchReportSectionDto[] {
  return [
    'executive-summary',
    'scope-and-method',
    'market-definition',
    'market-sizing',
    'growth-and-drivers',
    'customer-segments',
    'competitive-structure',
    'risks-and-opportunities',
    'limitations',
    'references',
  ].map((title, index) => createSection('section-' + index, title, index + 1))
}

class InMemoryReportRepository {
  readonly citations: ResearchCitationDto[] = []

  upsertCitation(input: Omit<ResearchCitationDto, 'id' | 'ordinal'>): ResearchCitationDto {
    const existing = this.citations.find((citation) => citation.claimId === input.claimId && citation.evidenceId === input.evidenceId)
    if (existing) return existing
    const citation: ResearchCitationDto = { ...input, id: 'citation-' + (this.citations.length + 1), ordinal: this.citations.length + 1 }
    this.citations.push(citation)
    return citation
  }

  listCitations(runId: string): ResearchCitationDto[] {
    return this.citations.filter((citation) => citation.runId === runId)
  }

  upsertArtifact(input: {
    runId: string
    type: 'report_markdown' | 'report_json' | 'evidence_appendix' | 'references' | 'run_manifest'
    fileName: string
    contentType: string
    storagePath: string
    sizeBytes: number
    idempotencyKey: string
  }) {
    return {
      id: input.type + '-artifact',
      runId: input.runId,
      type: input.type,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      createdAt: now,
    }
  }
}

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('Deep Research report quality', () => {
  it('keeps citation ordinals stable and rejects cross-run bindings', () => {
    const reportRepo = new InMemoryReportRepository()
    const service = new CitationService({
      reportRepo,
      listClaims: (id) => id === runId
        ? [createClaim('claim-a', 'section-a'), createClaim('claim-b', 'section-b')]
        : [],
      listEvidence: (id) => id === runId
        ? [createEvidence('evidence-a', 'source-a'), createEvidence('evidence-b', 'source-b')]
        : [createEvidence('evidence-other', 'source-other', { runId: otherRunId })],
    })

    const first = service.bind({ runId, claimId: 'claim-a', evidenceId: 'evidence-a', entailmentStatus: 'supported', rationale: 'direct' })
    const second = service.bind({ runId, claimId: 'claim-b', evidenceId: 'evidence-b', entailmentStatus: 'supported', rationale: 'direct' })
    const repeated = service.bind({ runId, claimId: 'claim-a', evidenceId: 'evidence-a', entailmentStatus: 'supported', rationale: 'direct' })

    expect([first.ordinal, second.ordinal, repeated.ordinal]).toEqual([1, 2, 1])
    expect(() => service.bind({ runId, claimId: 'claim-a', evidenceId: 'evidence-other', entailmentStatus: 'supported', rationale: 'invalid' }))
      .toThrowError('RESEARCH_CROSS_RUN_CITATION')
  })

  it('fails a report with an unsupported critical claim', () => {
    const section = createRequiredSections()[0]
    const quality = assessReportQuality({
      run: createRun(),
      questions: [createQuestion()],
      sections: createRequiredSections(),
      claims: [createClaim('claim-a', section.id, { importance: 'critical', verificationStatus: 'unsupported' })],
      citations: [],
      evidence: [],
      sources: [],
      snapshots: [],
    })

    expect(quality.releaseStatus).toBe('failed')
  })

  it('accepts semantically verified citations and disclosed contradictory evidence', () => {
    const sections = createRequiredSections()
    const evidence = [
      createEvidence('evidence-a', 'source-a'),
      createEvidence('evidence-b', 'source-b'),
      createEvidence('evidence-c', 'source-c', { stance: 'contradicting' }),
    ]
    const claims = [
      createClaim('claim-a', sections[0].id),
      createClaim('claim-b', sections[1].id),
      createClaim('claim-c', sections[2].id, {
        kind: 'limitation',
        importance: 'medium',
        text: 'Contradictory evidence is disclosed and limits confidence in the finding.',
        verificationStatus: 'not_applicable',
      }),
    ]
    const quality = assessReportQuality({
      run: createRun(),
      questions: [createQuestion()],
      sections,
      claims,
      citations: [
        createCitation('citation-a', claims[0].id, evidence[0].id),
        createCitation('citation-b', claims[1].id, evidence[1].id),
        createCitation('citation-c', claims[2].id, evidence[2].id),
      ],
      evidence,
      sources: [createSource('source-a', 'a.example.test'), createSource('source-b', 'b.example.test'), createSource('source-c', 'c.example.test')],
      snapshots: ['source-a', 'source-b', 'source-c'].map((sourceId) => ({
        id: 'snapshot-' + sourceId, runId, sourceId, contentHash: sourceId, content: 'snapshot', metadata: {}, fetchedAt: now, parserVersion: 'test', finalUrl: 'https://' + sourceId + '.example.test/research', httpStatus: 200,
      })),
    })

    expect(quality.supportedCitationCoverage).toBe(1)
    expect(quality.contradictionDisclosureCoverage).toBe(1)
    expect(quality.requiredSectionCoverage).toBe(1)
    expect(quality.releaseStatus).toBe('completed')
  })

  it('uses completed_with_limitations when the budget is exhausted and gaps are disclosed', () => {
    const sections = createRequiredSections()
    const run = createRun({ usage: { ...createRun().usage, deadlineAt: now - 1 } })
    const quality = assessReportQuality({
      run,
      questions: [createQuestion({ coverage: { ...createQuestion().coverage!, score: 0.6, gaps: ['independent sources'] }, status: 'limited' })],
      sections,
      claims: [createClaim('claim-a', sections[0].id)],
      citations: [createCitation('citation-a', 'claim-a', 'evidence-a')],
      evidence: [createEvidence('evidence-a', 'source-a')],
      sources: [createSource('source-a', 'a.example.test')],
      snapshots: [],
    })

    expect(quality.releaseStatus).toBe('completed_with_limitations')
    expect(quality.limitations).toEqual(expect.arrayContaining([expect.stringContaining('budget')]))
  })

  it('never formally completes zero high-priority coverage and records an actionable gate result', () => {
    const sections = createRequiredSections()
    const quality = assessReportQuality({
      run: createRun(),
      questions: [createQuestion({ status: 'limited', coverage: { ...createQuestion().coverage!, score: 0, gaps: ['primary evidence'] } })],
      sections,
      claims: [createClaim('claim-a', sections[0].id)],
      citations: [createCitation('citation-a', 'claim-a', 'evidence-a')],
      evidence: [createEvidence('evidence-a', 'source-a')],
      sources: [createSource('source-a', 'a.example.test')],
      snapshots: [{ id: 'snapshot-source-a', runId, sourceId: 'source-a', contentHash: 'hash', content: 'snapshot', metadata: {}, fetchedAt: now, parserVersion: 'test', finalUrl: 'https://a.example.test/research', httpStatus: 200 }],
    })

    expect(quality.releaseStatus).not.toBe('completed')
    expect(quality.gateResults).toEqual(expect.arrayContaining([expect.objectContaining({
      ruleId: 'high_priority_coverage', actual: 0, threshold: 0.8, passed: false,
      remedialAction: expect.stringContaining('gap-fill'),
    })]))
    expect(quality.remedialActions).toEqual(expect.arrayContaining([expect.stringContaining('gap-fill')]))
  })

  it('fails formal publication when key citations only have conservative structural verification', () => {
    const sections = createRequiredSections()
    const quality = assessReportQuality({
      run: createRun(),
      questions: [createQuestion()],
      sections,
      claims: [createClaim('claim-a', sections[0].id, { verificationStatus: 'partially_supported' })],
      citations: [createCitation('citation-a', 'claim-a', 'evidence-a', {
        entailmentStatus: 'partially_supported', verificationMethod: 'conservative_structural',
        semanticChecks: { entity: 'unclear', numericTemporal: 'not_applicable', relationship: 'unclear', stance: 'unclear' },
      })],
      evidence: [createEvidence('evidence-a', 'source-a')],
      sources: [createSource('source-a', 'a.example.test')],
      snapshots: [{ id: 'snapshot-source-a', runId, sourceId: 'source-a', contentHash: 'hash', content: 'snapshot', metadata: {}, fetchedAt: now, parserVersion: 'test', finalUrl: 'https://a.example.test/research', httpStatus: 200 }],
    })

    expect(quality.releaseStatus).toBe('failed')
    expect(quality.gateResults).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: 'citation_verification_capability', passed: false })]))
  })

  it('fails rather than releasing a limited draft when policy disables limited publication', () => {
    const sections = createRequiredSections()
    const quality = assessReportQuality({
      run: createRun(),
      questions: [createQuestion({ status: 'limited', coverage: { ...createQuestion().coverage!, score: 0.6, gaps: ['independent sources'] } })],
      sections,
      claims: [createClaim('claim-a', sections[0].id)],
      citations: [createCitation('citation-a', 'claim-a', 'evidence-a')],
      evidence: [createEvidence('evidence-a', 'source-a')],
      sources: [createSource('source-a', 'a.example.test')],
      snapshots: [{ id: 'snapshot-source-a', runId, sourceId: 'source-a', contentHash: 'hash', content: 'snapshot', metadata: {}, fetchedAt: now, parserVersion: 'test', finalUrl: 'https://a.example.test/research', httpStatus: 200 }],
    }, { ...DEFAULT_RESEARCH_QUALITY_GATE_POLICY, allowLimitedPublication: false })

    expect(quality.releaseStatus).toBe('failed')
  })

  it('writes verified Markdown and structured JSON artifacts', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-deepresearch-artifacts-'))
    createdDirectories.push(dataDir)
    const reportRepo = new InMemoryReportRepository()
    const brief: ResearchBriefDto = {
      title: 'Enterprise AI assistant market research',
      objective: 'Compare the market and leading vendors.',
      audience: 'Product strategy team',
      scope: 'United States enterprise AI assistant market',
      assumptions: ['Public sources only'],
      plannedSections: ['executive-summary'],
      criticalClarificationIds: [],
    }
    const sections = [createSection('section-a', 'executive-summary', 1)]
    const artifacts = new ArtifactService({ reportRepo, dataDir }).write({
      run: createRun({ brief, currentAttemptId: 'attempt-artifact-write' }),
      sections,
      claims: [createClaim('claim-a', 'section-a')],
      citations: [createCitation('citation-a', 'claim-a', 'evidence-a')],
      evidence: [createEvidence('evidence-a', 'source-a')],
      sources: [createSource('source-a', 'a.example.test')],
      snapshots: [
        {
          id: 'snapshot-source-a', runId, sourceId: 'source-a', contentHash: 'hash', content: 'source content', metadata: {}, fetchedAt: now, parserVersion: 'test', finalUrl: 'https://a.example.test/research', httpStatus: 200,
        } satisfies ResearchSourceSnapshotDto,
      ],
      questions: [createQuestion()],
      quality: {
        releaseStatus: 'completed', highPriorityQuestionCoverage: 1, factualClaimCitationCoverage: 1, supportedCitationCoverage: 1,
        independentCitedDomainCount: 1, contradictionDisclosureCoverage: 1, requiredSectionCoverage: 1, limitations: [], assessorVersion: 'test',
      },
    })

    expect(artifacts.map((artifact) => artifact.type)).toEqual(expect.arrayContaining(['report_markdown', 'report_json']))
    const artifactDirectory = path.join(dataDir, 'deepresearch', 'runs', runId)
    expect(fs.readFileSync(path.join(artifactDirectory, 'report.md'), 'utf8')).toContain('# Enterprise AI assistant market research')
    expect(JSON.parse(fs.readFileSync(path.join(artifactDirectory, 'report.json'), 'utf8'))).toMatchObject({ runId, quality: { releaseStatus: 'completed' } })
    const reportManifest = JSON.parse(fs.readFileSync(path.join(artifactDirectory, 'report.md.reconciliation.json'), 'utf8'))
    expect(reportManifest).toMatchObject({
      version: 1,
      runId,
      attemptId: 'attempt-artifact-write',
      type: 'report_markdown',
      fileName: 'report.md',
      registrationState: 'registered',
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      generatedAt: expect.any(Number),
    })
    expect(createReportMarkdown({
      run: createRun({ brief, currentAttemptId: 'attempt-artifact-write' }), questions: [createQuestion()], sections,
      claims: [createClaim('claim-a', 'section-a')], citations: [createCitation('citation-a', 'claim-a', 'evidence-a')],
      evidence: [createEvidence('evidence-a', 'source-a')], sources: [createSource('source-a', 'a.example.test')], snapshots: [],
      quality: { releaseStatus: 'completed_with_limitations', highPriorityQuestionCoverage: 0.8, factualClaimCitationCoverage: 1, supportedCitationCoverage: 1, independentCitedDomainCount: 1, contradictionDisclosureCoverage: 1, requiredSectionCoverage: 1, limitations: ['More evidence is needed.'], assessorVersion: 'test' },
    })).toContain('Draft with limitations — not a formally published deep research report.')
    const chinese = new ArtifactService({ reportRepo, dataDir }).writeChineseMarkdown(runId, '# \u4e2d\u6587\u62a5\u544a\n')
    expect(chinese.type).toBe('report_markdown_zh_cn')
    expect(fs.readFileSync(path.join(artifactDirectory, 'report.zh-CN.md'), 'utf8')).toContain('\u4e2d\u6587\u62a5\u544a')
  })
})
