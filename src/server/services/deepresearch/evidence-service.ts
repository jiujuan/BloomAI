import { createHash } from 'node:crypto'
import { createEvidenceFingerprint } from '@server/deepresearch/domain/idempotency'
import { z } from 'zod'
import { throwIfCancellationRequested } from '@server/deepresearch/domain/cancellation'
import type {
  ResearchCoverageAssessmentV2Dto,
  ResearchCoverageDto,
  ResearchEvidenceDto,
  ResearchQuestionDto,
  ResearchRunDto,
  ResearchSearchQueryDto,
  ResearchSourceDto,
  ResearchSourceSnapshotDto,
} from '@shared/deepresearch/contracts'
import type { UpsertResearchEvidenceInput } from '@server/db/repositories/deepresearch/research-evidence.repo'
import { assessCoveragePolicyV2, type CoveragePolicyEvidence } from '@server/deepresearch/domain/coverage-policy'

export const EVIDENCE_PACKET_CHARACTER_BUDGET = 1_200
export const EVIDENCE_PASSAGE_MIN_CHARACTERS = 80
export const EVIDENCE_PASSAGE_MAX_CHARACTERS = 800
export const MAX_EVIDENCE_PER_SOURCE = 2
export const MAX_EVIDENCE_PER_QUESTION = 8

const evidenceTypeSchema = z.enum(['fact', 'analysis', 'marketing_claim', 'opinion', 'uncertain'])
const evidenceNumberSchema = z.object({
  value: z.string().trim().min(1).max(80),
  unit: z.string().trim().min(1).max(80).nullable(),
  context: z.string().trim().min(1).max(240).nullable(),
}).strict()
const evidenceAnalysisSchema = z.object({
  questionId: z.string().min(1),
  // A model may supply this for auditability; the persisted value is always
  // derived from the snapshot to prevent cross-source attribution.
  sourceId: z.string().min(1).optional(),
  snapshotId: z.string().min(1),
  passage: z.string().min(1).max(EVIDENCE_PASSAGE_MAX_CHARACTERS),
  summary: z.string().trim().min(12).max(1_000),
  claim: z.string().trim().min(8).max(1_000).optional(),
  evidenceType: evidenceTypeSchema.optional(),
  entities: z.array(z.string().trim().min(1).max(160)).max(32).optional(),
  numbers: z.array(evidenceNumberSchema).max(24).optional(),
  timeframe: z.string().trim().min(1).max(160).nullable().optional(),
  stance: z.enum(['supporting', 'contradicting', 'contextual']),
  relevance: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().positive(),
})

/** Backwards-compatible adapter input; all optional structured fields are normalized before persistence. */
export type EvidenceAnalysis = z.infer<typeof evidenceAnalysisSchema>

export interface EvidencePacket {
  snapshotId: string
  sourceId: string
  sourceUrl: string
  sourceTitle: string | null
  sourceType: string
  domain: string
  publishedAt: number | null
  heading: string | null
  startOffset: number
  endOffset: number
  text: string
  /** Scores persisted by DRQ-05. Missing values deliberately rank last. */
  sourceRelevance?: number
  sourceAuthority?: number
  sourceIndependence?: number
}

export interface EvidenceAnalyst {
  analyze(input: {
    run: ResearchRunDto
    questions: ResearchQuestionDto[]
    packets: EvidencePacket[]
  }, options?: { signal?: AbortSignal }): Promise<EvidenceAnalysis[]>
}

const QUESTION_STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'what', 'which', 'when', 'where', 'how', 'why', 'are', 'was', 'were', 'has', 'have', 'into', 'about', 'evidence', 'research', '问题', '证据', '什么', '哪些', '如何', '以及'])

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function semanticTokens(value: string): string[] {
  const normalized = value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[_-]/g, ' ')
  const latin = normalized.match(/[a-z][a-z0-9-]{1,}/g) ?? []
  const cjk = (normalized.match(/[\u3400-\u9fff]+/gu) ?? []).flatMap((run) => {
    const bigrams = Array.from({ length: Math.max(0, run.length - 1) }, (_, index) => run.slice(index, index + 2))
    return run.length >= 2 ? [run, ...bigrams] : [run]
  })
  return [...new Set([...latin, ...cjk].filter((token) => !QUESTION_STOP_WORDS.has(token)))]
}

function textRelevance(question: ResearchQuestionDto, text: string): number {
  const questionTokens = semanticTokens(`${question.question} ${question.intent}`)
  if (questionTokens.length === 0) return 1
  const textTokens = new Set(semanticTokens(text))
  const matched = questionTokens.filter((token) => textTokens.has(token)).length
  return matched / questionTokens.length
}

function normalizedScore(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  // Source-curator scores use a 0..1 range; DRQ-05 assessment records use 0..100.
  return clampUnit(value > 1 ? value / 100 : value)
}

function sourceScore(source: ResearchSourceDto): Pick<EvidencePacket, 'sourceRelevance' | 'sourceAuthority' | 'sourceIndependence'> {
  const scores = source.scores as Record<string, unknown>
  const breakdown = scores.breakdown && typeof scores.breakdown === 'object' && !Array.isArray(scores.breakdown)
    ? scores.breakdown as Record<string, unknown>
    : {}
  return {
    sourceRelevance: normalizedScore(breakdown.relevance) ?? normalizedScore(scores.finalScore) ?? 0,
    sourceAuthority: normalizedScore(breakdown.authority) ?? 0,
    sourceIndependence: normalizedScore(breakdown.independence) ?? 0,
  }
}

const VENDOR_CONTROLLED_SOURCE = /company[_ -]?official|product[_ -]?documentation|pricing|customer[_ -]?case/i
const VENDOR_SELF_ASSERTION = /\b(we|our|ours|best|leading|market[- ]?leading|fastest|guarantee|deliver|return on investment|roi)\b|我们|本公司|领先|最佳|最快|保证|回报率/u
const QUANTITATIVE_EXPRESSION = /(?:\d+(?:[,.]\d+)?\s*(?:%|percent|million|billion|thousand|万|亿|美元|人民币|元|年|月|季度|q[1-4])?|[一二三四五六七八九十百千万亿]+(?:个百分点|%|年|月|季度))/iu

function normalizedEvidenceType(
  source: ResearchSourceDto,
  passage: string,
  evidenceType: NonNullable<EvidenceAnalysis['evidenceType']>,
): NonNullable<EvidenceAnalysis['evidenceType']> {
  // Product/vendor material can be factual for narrowly attributable product details,
  // but self-promotional market assertions must remain explicitly labelled.
  if (evidenceType === 'fact' && VENDOR_CONTROLLED_SOURCE.test(source.sourceType) && VENDOR_SELF_ASSERTION.test(passage)) {
    return 'marketing_claim'
  }
  return evidenceType
}

function passageSimilarity(left: string, right: string): number {
  const leftTokens = new Set(semanticTokens(left))
  const rightTokens = new Set(semanticTokens(right))
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0
  let shared = 0
  for (const token of leftTokens) if (rightTokens.has(token)) shared += 1
  return shared / new Set([...leftTokens, ...rightTokens]).size
}

function isNearDuplicateEvidence(left: string, right: string): boolean {
  const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US')
  return normalize(left) === normalize(right) || passageSimilarity(left, right) >= 0.85
}

function requiresQuantitativeEvidence(question: ResearchQuestionDto): boolean {
  return question.needQuantitativeEvidence || /market|growth|revenue|size|statistics|统计|规模|增长|营收|收入/.test(`${question.question} ${question.intent}`)
}

function normalizedPassageText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim()
}

function passageContainsPhrase(passage: string, value: string): boolean {
  return normalizedPassageText(passage).includes(normalizedPassageText(value))
}

function statementIsGrounded(statement: string, passage: string): boolean {
  const statementTokens = semanticTokens(statement)
  if (statementTokens.length === 0) return false
  const passageTokens = new Set(semanticTokens(passage))
  const matches = statementTokens.filter((token) => passageTokens.has(token)).length
  const statementNumbers = statement.match(/\d+(?:[,.]\d+)?/g) ?? []
  return matches / statementTokens.length >= 0.5
    && statementNumbers.every((value) => numberValueAppears(value, passage))
}

function numberValueAppears(value: string, passage: string): boolean {
  if (passageContainsPhrase(passage, value)) return true
  const normalized = value.replace(/[\s,]/g, '')
  return (passage.match(/\d+(?:[,.]\d+)?/g) ?? [])
    .some((candidate) => candidate.replace(/[\s,]/g, '') === normalized)
}

function numberUnitAppears(unit: string | null, passage: string): boolean {
  if (!unit) return true
  const normalized = normalizedPassageText(unit)
  if (normalized === 'percent' || normalized === '%') return /%|\bpercent\b/i.test(passage)
  return passageContainsPhrase(passage, unit)
}

function isSupportedNumber(number: NonNullable<EvidenceAnalysis['numbers']>[number], passage: string): boolean {
  return numberValueAppears(number.value, passage)
    && numberUnitAppears(number.unit, passage)
    && (!number.context || statementIsGrounded(number.context, passage))
}

function supportedEntities(entities: string[], passage: string): string[] {
  return entities.filter((entity) => passageContainsPhrase(passage, entity))
}

function supportedTimeframe(timeframe: string | null, passage: string): string | null {
  return timeframe && passageContainsPhrase(passage, timeframe) ? timeframe : null
}
function targetScore(question: ResearchQuestionDto, packet: EvidencePacket): number {
  const targets = question.sourceTargets ?? []
  if (targets.length === 0) return 0
  const candidate = `${packet.domain} ${packet.sourceType} ${packet.sourceTitle ?? ''}`.toLocaleLowerCase('en-US').replace(/[_-]/g, ' ')
  return targets.some((target) => {
    const normalized = target.toLocaleLowerCase('en-US').replace(/[_-]/g, ' ').trim()
    return normalized.length >= 3 && (candidate.includes(normalized) || normalized.includes(packet.sourceType.replace(/[_-]/g, ' ')))
  }) ? 1 : 0
}

/**
 * Applies question-level semantic relevance before source quality and target boosts.
 * A source target never overrides an unrelated passage: it merely breaks ties among
 * passages that already answer the question.
 */
export function rankEvidencePackets(question: ResearchQuestionDto, packets: EvidencePacket[]): EvidencePacket[] {
  const ranked = packets
    .map((packet, originalIndex) => ({
      packet,
      originalIndex,
      relevance: textRelevance(question, packet.text),
      target: targetScore(question, packet),
    }))
    .filter(({ relevance }) => relevance >= 0.15)
    .sort((left, right) => {
      const leftScore = left.relevance * 100 + left.target * 20 + (left.packet.sourceRelevance ?? 0) * 12 + (left.packet.sourceAuthority ?? 0) * 8 + (left.packet.sourceIndependence ?? 0) * 5
      const rightScore = right.relevance * 100 + right.target * 20 + (right.packet.sourceRelevance ?? 0) * 12 + (right.packet.sourceAuthority ?? 0) * 8 + (right.packet.sourceIndependence ?? 0) * 5
      return rightScore - leftScore || left.originalIndex - right.originalIndex
    })

  // Round-robin sources after ranking: a second paragraph from a source is valuable,
  // but should not crowd out an independent relevant source.
  const bySource = new Map<string, EvidencePacket[]>()
  for (const { packet } of ranked) {
    const entries = bySource.get(packet.sourceId) ?? []
    if (entries.length < MAX_EVIDENCE_PER_SOURCE) entries.push(packet)
    bySource.set(packet.sourceId, entries)
  }
  const ordered: EvidencePacket[] = []
  for (let index = 0; ; index += 1) {
    let added = false
    for (const entries of bySource.values()) {
      const packet = entries[index]
      if (!packet) continue
      ordered.push(packet)
      added = true
    }
    if (!added) return ordered
  }
}

interface AnalyzedEvidence {
  analysis: EvidenceAnalysis
  activeQuestionId: string
  allowedSnapshotIds: ReadonlySet<string>
  packetRanges: ReadonlyMap<string, Pick<EvidencePacket, 'startOffset' | 'endOffset'>[]>
}

interface PreparedEvidence {
  analysis: EvidenceAnalysis
  question: ResearchQuestionDto
  snapshot: ResearchSourceSnapshotDto
  source: ResearchSourceDto
  evidenceType: NonNullable<EvidenceAnalysis['evidenceType']>
  summary: string
  claim: string
  entities: string[]
  numbers: NonNullable<EvidenceAnalysis['numbers']>
  timeframe: string | null
  relevance: number
  stance: EvidenceAnalysis['stance']
}
function evidencePriority(candidate: PreparedEvidence): number {
  const quality = sourceScore(candidate.source)
  return candidate.relevance * 100 + candidate.analysis.confidence * 15
    + (quality.sourceRelevance ?? 0) * 12 + (quality.sourceAuthority ?? 0) * 8 + (quality.sourceIndependence ?? 0) * 5
}

/** Keep sources interleaved after validation so one prolific source cannot crowd out corroboration. */
function roundRobinEvidenceCandidates(candidates: PreparedEvidence[]): PreparedEvidence[] {
  const byQuestion = new Map<string, PreparedEvidence[]>()
  for (const candidate of candidates) {
    const entries = byQuestion.get(candidate.question.id) ?? []
    entries.push(candidate)
    byQuestion.set(candidate.question.id, entries)
  }
  const ordered: PreparedEvidence[] = []
  for (const questionCandidates of byQuestion.values()) {
    const bySource = new Map<string, PreparedEvidence[]>()
    for (const candidate of questionCandidates) {
      const entries = bySource.get(candidate.source.id) ?? []
      entries.push(candidate)
      bySource.set(candidate.source.id, entries)
    }
    const sourceQueues = [...bySource.values()]
      .map((entries) => entries.sort((left, right) => evidencePriority(right) - evidencePriority(left) || left.analysis.startOffset - right.analysis.startOffset))
      .sort((left, right) => evidencePriority(right[0]) - evidencePriority(left[0]))
    for (let index = 0; ; index += 1) {
      let added = false
      for (const entries of sourceQueues) {
        const candidate = entries[index]
        if (!candidate) continue
        ordered.push(candidate)
        added = true
      }
      if (!added) break
    }
  }
  return ordered
}

export interface EvidenceServiceSourceRepository {
  listSources(runId: string): ResearchSourceDto[]
  listSnapshots(runId: string): ResearchSourceSnapshotDto[]
}

export interface EvidenceServiceEvidenceRepository {
  upsertEvidence(input: UpsertResearchEvidenceInput): ResearchEvidenceDto
  list(runId: string): ResearchEvidenceDto[]
}

export interface EvidenceServiceQuestionRepository {
  /** Optional for backwards-compatible unit-test and legacy repository adapters. */
  listSearchQueries?(runId: string): ResearchSearchQueryDto[]
  updateCoverage(
    id: string,
    data: { coverage: ResearchCoverageDto; status: ResearchQuestionDto['status'] },
  ): ResearchQuestionDto
}

export interface EvidenceServiceOptions {
  analyst: EvidenceAnalyst
  sourceRepo: EvidenceServiceSourceRepository
  evidenceRepo: EvidenceServiceEvidenceRepository
  questionRepo: EvidenceServiceQuestionRepository
  packetCharacterBudget?: number
  /** Injected only for deterministic service-level coverage tests. */
  clock?: () => number
}

export interface CoverageAssessmentProjectionV2 {
  policyVersion: 'v2'
  inputFingerprint: string
  aggregateScore: number
  questionAssessments: ResearchCoverageAssessmentV2Dto[]
  coverageProjections: ResearchCoverageDto[]
  limitations: string[]
}
export interface EvidenceExtractionResult {
  createdCount: number
  rejectedCount: number
  coverage: ResearchCoverageDto[]
}

const LEGACY_GAP_LABELS: Readonly<Record<string, string>> = Object.freeze({
  NO_EVIDENCE: 'no citable evidence',
  SINGLE_DOMAIN: 'independent sources',
  MISSING_REQUIRED_TYPE: 'required evidence category',
  NO_AUTHORITATIVE_SOURCE: 'primary or authoritative source',
  STALE_EVIDENCE: 'recent source',
  UNRESOLVED_CONTRADICTION: 'unresolved contradiction',
  INSUFFICIENT_CONFIDENCE: 'insufficient confidence',
})

function coverageThreshold(priority: ResearchQuestionDto['priority']): number {
  if (priority === 'critical') return 0.85
  if (priority === 'high') return 0.8
  if (priority === 'medium') return 0.7
  return 0.6
}

export function isQuestionCovered(question: ResearchQuestionDto): boolean {
  const coverage = question.coverage
  if (!coverage) return false
  return coverage.score >= coverageThreshold(question.priority) && !coverage.hasSingleSourceDependency
}

export function areHighPriorityQuestionsCovered(questions: ResearchQuestionDto[]): boolean {
  return questions
    .filter((question) => question.priority === 'high' || question.priority === 'critical')
    .every(isQuestionCovered)
}

function headingAt(content: string, position: number): string | null {
  const headers = [...content.matchAll(/^#{1,6}\s+(.+)$/gm)]
  let heading: string | null = null
  for (const header of headers) {
    if ((header.index ?? 0) > position) break
    heading = header[1].trim()
  }
  return heading
}

interface SnapshotParagraphRange {
  startOffset: number
  endOffset: number
}

function snapshotParagraphRanges(snapshot: ResearchSourceSnapshotDto): SnapshotParagraphRange[] {
  const paragraphs = snapshot.metadata.paragraphs
  if (!Array.isArray(paragraphs)) return []
  const ranges = paragraphs.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const { startOffset, endOffset } = value as Record<string, unknown>
    if (typeof startOffset !== 'number' || typeof endOffset !== 'number' || !Number.isInteger(startOffset) || !Number.isInteger(endOffset) || startOffset < 0 || endOffset <= startOffset || endOffset > snapshot.content.length) return []
    return [{ startOffset, endOffset }]
  }).sort((left, right) => left.startOffset - right.startOffset)
  return ranges.every((range, index) => index === 0 || range.startOffset >= ranges[index - 1].endOffset) ? ranges : []
}

export function createSnapshotPackets(
  snapshot: ResearchSourceSnapshotDto,
  source: ResearchSourceDto,
  characterBudget: number,
): EvidencePacket[] {
  const packets: EvidencePacket[] = []
  const content = snapshot.content
  const appendPacket = (startOffset: number, endOffset: number) => {
    const text = content.slice(startOffset, endOffset)
    if (!text.trim()) return
    packets.push({
      snapshotId: snapshot.id,
      sourceId: source.id,
      sourceUrl: snapshot.finalUrl,
      sourceTitle: source.title,
      sourceType: source.sourceType,
      domain: source.domain,
      publishedAt: source.publishedAt,
      heading: headingAt(content, startOffset),
      startOffset,
      endOffset,
      text,
      ...sourceScore(source),
    })
  }
  const paragraphs = snapshotParagraphRanges(snapshot)
  if (paragraphs.length > 0) {
    let packetStart = paragraphs[0].startOffset
    let packetEnd = packetStart
    for (const paragraph of paragraphs) {
      if (paragraph.endOffset - paragraph.startOffset > characterBudget) {
        if (packetEnd > packetStart) appendPacket(packetStart, packetEnd)
        for (let startOffset = paragraph.startOffset; startOffset < paragraph.endOffset; startOffset += characterBudget) {
          appendPacket(startOffset, Math.min(paragraph.endOffset, startOffset + characterBudget))
        }
        packetStart = paragraph.endOffset
        packetEnd = paragraph.endOffset
        continue
      }
      if (packetEnd > packetStart && paragraph.endOffset - packetStart > characterBudget) {
        appendPacket(packetStart, packetEnd)
        packetStart = paragraph.startOffset
      }
      packetEnd = paragraph.endOffset
    }
    if (packetEnd > packetStart) appendPacket(packetStart, packetEnd)
    return packets
  }
  for (let startOffset = 0; startOffset < content.length; startOffset += characterBudget) {
    appendPacket(startOffset, Math.min(content.length, startOffset + characterBudget))
  }
  return packets
}

export class EvidenceService {
  private readonly packetCharacterBudget: number

  constructor(private readonly options: EvidenceServiceOptions) {
    this.packetCharacterBudget = options.packetCharacterBudget ?? EVIDENCE_PACKET_CHARACTER_BUDGET
  }

  createPackets(run: ResearchRunDto): EvidencePacket[] {
    const sources = new Map(this.options.sourceRepo.listSources(run.id).map((source) => [source.id, source]))
    return this.options.sourceRepo
      .listSnapshots(run.id)
      .flatMap((snapshot) => {
        const source = sources.get(snapshot.sourceId)
        return source ? createSnapshotPackets(snapshot, source, this.packetCharacterBudget) : []
      })
  }

  async extract(run: ResearchRunDto, questions: ResearchQuestionDto[], cancellation: { signal?: AbortSignal; isCancelled?: () => boolean } = {}): Promise<EvidenceExtractionResult> {
    throwIfCancellationRequested(cancellation)
    const snapshots = new Map(this.options.sourceRepo.listSnapshots(run.id).map((snapshot) => [snapshot.id, snapshot]))
    // Evidence rows are the durable boundary for provider calls. A resume after
    // persistence but before coverage assessment must only analyse snapshots that
    // have not produced any stored evidence yet.
    const persistedEvidence = this.options.evidenceRepo.list(run.id)
    const processedSnapshotIds = new Set(persistedEvidence.map((evidence) => evidence.snapshotId))
    const packets = this.createPackets(run).filter((packet) => !processedSnapshotIds.has(packet.snapshotId))
    const runnableQuestions = questions.filter((question) => question.runId === run.id)
    const knownQuestionIds = new Set(runnableQuestions.map((question) => question.id))
    const existingEvidenceIds = new Set(persistedEvidence.map((evidence) => evidence.id))
    const sourcesById = new Map(this.options.sourceRepo.listSources(run.id).map((source) => [source.id, source]))
    const questionIdByQueryId = new Map(
      (this.options.questionRepo.listSearchQueries?.(run.id) ?? [])
        .filter((query) => query.runId === run.id && knownQuestionIds.has(query.questionId))
        .map((query) => [query.id, query.questionId]),
    )
    const packetsByQuestionId = new Map<string, EvidencePacket[]>()
    const unassignedPackets: EvidencePacket[] = []
    for (const packet of packets) {
      const queryId = sourcesById.get(packet.sourceId)?.scores.queryId
      const questionId = typeof queryId === 'string' ? questionIdByQueryId.get(queryId) : undefined
      if (!questionId) {
        unassignedPackets.push(packet)
        continue
      }
      const assigned = packetsByQuestionId.get(questionId) ?? []
      assigned.push(packet)
      packetsByQuestionId.set(questionId, assigned)
    }
    // Legacy sources did not record query provenance. They can safely be used
    // when there is only one question; broadcasting them to every question
    // creates duplicate evidence and repeated report sections.
    if (runnableQuestions.length === 1 && unassignedPackets.length > 0) {
      const [question] = runnableQuestions
      packetsByQuestionId.set(question.id, [...(packetsByQuestionId.get(question.id) ?? []), ...unassignedPackets])
    }
    const analyses: AnalyzedEvidence[] = []
    for (const question of runnableQuestions) {
      const questionPackets = rankEvidencePackets(question, packetsByQuestionId.get(question.id) ?? [])
      if (questionPackets.length === 0) continue
      const packetRanges = new Map<string, Pick<EvidencePacket, 'startOffset' | 'endOffset'>[]>()
      for (const packet of questionPackets) {
        const ranges = packetRanges.get(packet.snapshotId) ?? []
        ranges.push(packet)
        packetRanges.set(packet.snapshotId, ranges)
      }
      const allowedSnapshotIds = new Set(questionPackets.map((packet) => packet.snapshotId))
      throwIfCancellationRequested(cancellation)
      const output = await this.options.analyst.analyze({ run, questions: [question], packets: questionPackets }, { signal: cancellation.signal })
      analyses.push(...output.map((analysis) => ({
        analysis,
        activeQuestionId: question.id,
        allowedSnapshotIds,
        packetRanges,
      })))
    }
    throwIfCancellationRequested(cancellation)
    let createdCount = 0
    let rejectedCount = 0

    const questionsById = new Map(runnableQuestions.map((question) => [question.id, question]))
    const prepared: PreparedEvidence[] = []
    for (const candidate of analyses) {
      const parsed = evidenceAnalysisSchema.safeParse(candidate.analysis)
      if (!parsed.success) {
        rejectedCount += 1
        continue
      }
      const analysis = parsed.data
      const snapshot = snapshots.get(analysis.snapshotId)
      const source = snapshot ? sourcesById.get(snapshot.sourceId) : undefined
      const question = questionsById.get(analysis.questionId)
      const passageLength = analysis.endOffset - analysis.startOffset
      const fitsPacket = (candidate.packetRanges.get(analysis.snapshotId) ?? []).some((packet) => (
        analysis.startOffset >= packet.startOffset && analysis.endOffset <= packet.endOffset
      ))
      // A model score cannot override deterministic question/passage routing.
      const localRelevance = question ? textRelevance(question, analysis.passage) : 0
      const relevance = Math.min(analysis.relevance ?? 1, localRelevance)
      const providedNumbers = analysis.numbers ?? []
      // Never persist LLM-supplied numeric metadata unless each value, unit, and
      // context can be traced to the exact source passage.
      const numbers = providedNumbers.filter((number) => isSupportedNumber(number, analysis.passage))
      const timeframe = supportedTimeframe(analysis.timeframe ?? null, analysis.passage)
      const entities = supportedEntities(analysis.entities ?? [], analysis.passage)
      const summary = statementIsGrounded(analysis.summary, analysis.passage) ? analysis.summary : analysis.passage
      const claim = analysis.claim && statementIsGrounded(analysis.claim, analysis.passage) ? analysis.claim : summary
      const containsQuantitativeExpression = QUANTITATIVE_EXPRESSION.test(analysis.passage)
      QUANTITATIVE_EXPRESSION.lastIndex = 0
      const lacksQuantitativeContext = Boolean(
        question && (question.priority === 'high' || question.priority === 'critical')
        && requiresQuantitativeEvidence(question)
        && containsQuantitativeExpression && (numbers.length === 0 || !timeframe),
      )
      if (
        analysis.questionId !== candidate.activeQuestionId
        || !candidate.allowedSnapshotIds.has(analysis.snapshotId)
        || !question
        || !snapshot
        || !source
        || snapshot.runId !== run.id
        || source.runId !== run.id
        || analysis.endOffset <= analysis.startOffset
        || passageLength < EVIDENCE_PASSAGE_MIN_CHARACTERS
        || passageLength > EVIDENCE_PASSAGE_MAX_CHARACTERS
        || !fitsPacket
        || snapshot.content.slice(analysis.startOffset, analysis.endOffset) !== analysis.passage
        || relevance < 0.15
        || lacksQuantitativeContext
      ) {
        rejectedCount += 1
        continue
      }
      const requestedEvidenceType = analysis.evidenceType
      const evidenceType = normalizedEvidenceType(source, analysis.passage, requestedEvidenceType ?? 'uncertain')
      prepared.push({
        analysis,
        question,
        snapshot,
        source,
        evidenceType,
        summary,
        claim,
        entities,
        numbers,
        timeframe,
        relevance,
        // Preserve the stance of legacy analyst inputs that predate evidence typing.
        // Explicit subjective/uncertain types and server-side vendor reclassification
        // must remain contextual regardless of the model-provided stance.
        stance: requestedEvidenceType === 'marketing_claim'
          || requestedEvidenceType === 'opinion'
          || requestedEvidenceType === 'uncertain'
          || (requestedEvidenceType === 'fact' && evidenceType !== requestedEvidenceType)
          ? 'contextual'
          : analysis.stance,
      })
    }
    const acceptedByQuestion = new Map<string, ResearchEvidenceDto[]>()
    const sourceCounts = new Map<string, number>()
    for (const evidence of persistedEvidence) {
      const accepted = acceptedByQuestion.get(evidence.questionId) ?? []
      accepted.push(evidence)
      acceptedByQuestion.set(evidence.questionId, accepted)
      const sourceId = evidence.sourceId || snapshots.get(evidence.snapshotId)?.sourceId
      if (sourceId) sourceCounts.set(`${evidence.questionId}:${sourceId}`, (sourceCounts.get(`${evidence.questionId}:${sourceId}`) ?? 0) + 1)
    }

    for (const candidate of roundRobinEvidenceCandidates(prepared)) {
      const accepted = acceptedByQuestion.get(candidate.question.id) ?? []
      const sourceKey = `${candidate.question.id}:${candidate.source.id}`
      const sourceCount = sourceCounts.get(sourceKey) ?? 0
      if (
        accepted.length >= MAX_EVIDENCE_PER_QUESTION
        || sourceCount >= MAX_EVIDENCE_PER_SOURCE
        || accepted.some((item) => isNearDuplicateEvidence(item.passage, candidate.analysis.passage))
      ) {
        rejectedCount += 1
        continue
      }

      const persisted = this.options.evidenceRepo.upsertEvidence({
        runId: run.id,
        questionId: candidate.analysis.questionId,
        // Snapshot ownership is the authoritative source attribution boundary.
        sourceId: candidate.snapshot.sourceId,
        snapshotId: candidate.analysis.snapshotId,
        passage: candidate.analysis.passage,
        summary: candidate.summary,
        claim: candidate.claim,
        evidenceType: candidate.evidenceType,
        entities: candidate.entities,
        numbers: candidate.numbers,
        timeframe: candidate.timeframe,
        stance: candidate.stance,
        relevance: candidate.relevance,
        confidence: candidate.analysis.confidence,
        startOffset: candidate.analysis.startOffset,
        endOffset: candidate.analysis.endOffset,
        idempotencyKey: createEvidenceFingerprint(candidate.analysis),
      })
      accepted.push(persisted)
      acceptedByQuestion.set(candidate.question.id, accepted)
      sourceCounts.set(sourceKey, sourceCount + 1)
      if (!existingEvidenceIds.has(persisted.id)) {
        existingEvidenceIds.add(persisted.id)
        createdCount += 1
      }
    }

    const coverage = this.assessCoverage(run, questions)
    return { createdCount, rejectedCount, coverage }
  }

  assessCoverageV2(run: ResearchRunDto, questions: ResearchQuestionDto[]): ResearchCoverageAssessmentV2Dto[] {
    const sources = new Map(this.options.sourceRepo.listSources(run.id).map((source) => [source.id, source]))
    const snapshots = new Map(this.options.sourceRepo.listSnapshots(run.id).map((snapshot) => [snapshot.id, snapshot]))
    const evidence = this.options.evidenceRepo.list(run.id)
    const assessedAt = (this.options.clock ?? Date.now)()

    return questions
      .filter((question) => question.runId === run.id)
      .map((question) => {
        const questionEvidence = evidence.filter((item) => item.questionId === question.id)
        const policyEvidence: CoveragePolicyEvidence[] = questionEvidence.flatMap((item) => {
          const snapshot = snapshots.get(item.snapshotId)
          const source = snapshot ? sources.get(snapshot.sourceId) : undefined
          if (!snapshot || !source || snapshot.runId !== run.id || source.runId !== run.id) return []
          return [{
            id: item.id,
            sourceId: source.id,
            domain: source.domain,
            sourceType: source.sourceType,
            publishedAt: source.publishedAt,
            stance: item.stance,
            confidence: item.confidence,
          }]
        })
        return assessCoveragePolicyV2({
          questionId: question.id,
          question: question.question,
          intent: question.intent,
          profile: run.profile,
          priority: question.priority,
          requiredEvidenceTypes: question.requiredEvidenceTypes,
          evidence: policyEvidence,
          assessedAt,
        })
      })
  }
  assessCoverageProjectionV2(run: ResearchRunDto, questions: ResearchQuestionDto[]): CoverageAssessmentProjectionV2 {
    const sources = new Map(this.options.sourceRepo.listSources(run.id).map((source) => [source.id, source]))
    const snapshots = new Map(this.options.sourceRepo.listSnapshots(run.id).map((snapshot) => [snapshot.id, snapshot]))
    const questionAssessments = this.assessCoverageV2(run, questions)
    const assessmentByQuestionId = new Map(questionAssessments.map((assessment) => [assessment.questionId, assessment]))
    const evidence = this.options.evidenceRepo.list(run.id)
    const coverageProjections = questions
      .filter((question) => question.runId === run.id)
      .map((question) => {
        const assessment = assessmentByQuestionId.get(question.id)!
        const associatedSources = evidence
          .filter((item) => item.questionId === question.id)
          .flatMap((item) => {
            const snapshot = snapshots.get(item.snapshotId)
            const source = snapshot ? sources.get(snapshot.sourceId) : undefined
            return source && snapshot?.runId === run.id && source.runId === run.id ? [source] : []
          })
        return {
          questionId: question.id,
          score: assessment.score,
          independentDomainCount: assessment.sourceCounts.independentDomains,
          evidenceCategories: [...new Set(associatedSources.map((source) => source.sourceType))].sort(),
          primarySourceCount: assessment.sourceCounts.primaryOrAuthoritative,
          recentSourceCount: assessment.sourceCounts.recent,
          supportingEvidenceCount: assessment.support.supporting,
          contradictingEvidenceCount: assessment.support.contradicting,
          hasSingleSourceDependency: assessment.sourceCounts.evidence > 0 && assessment.sourceCounts.independentDomains < 2,
          gaps: assessment.gaps.map((gap) => LEGACY_GAP_LABELS[gap.code]),
        } satisfies ResearchCoverageDto
      })
    const limitations = [...new Set(questionAssessments.flatMap((item) => item.limitation ? [item.limitation] : []))].sort()
    const aggregateScore = questionAssessments.length === 0
      ? 0
      : questionAssessments.reduce((total, item) => total + item.score, 0) / questionAssessments.length
    const inputFingerprint = createHash('sha256').update(JSON.stringify({
      policyVersion: 'v2', runId: run.id, profile: run.profile,
      questionInputs: questionAssessments.map((item) => ({ questionId: item.questionId, inputFingerprint: item.inputFingerprint }))
        .sort((left, right) => left.questionId.localeCompare(right.questionId)),
    })).digest('hex')
    return { policyVersion: 'v2', inputFingerprint, aggregateScore, questionAssessments, coverageProjections, limitations }
  }

  assessCoverage(run: ResearchRunDto, questions: ResearchQuestionDto[]): ResearchCoverageDto[] {
    const projection = this.assessCoverageProjectionV2(run, questions)
    const assessmentByQuestionId = new Map(projection.questionAssessments.map((assessment) => [assessment.questionId, assessment]))
    for (const coverage of projection.coverageProjections) {
      const assessment = assessmentByQuestionId.get(coverage.questionId)!
      const status: ResearchQuestionDto['status'] = assessment.verdict === 'covered'
        ? 'covered'
        : assessment.verdict === 'uncovered'
          ? 'researching'
          : 'limited'
      this.options.questionRepo.updateCoverage(coverage.questionId, { coverage, status })
    }
    return projection.coverageProjections
  }
}
