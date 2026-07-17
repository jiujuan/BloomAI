import { createHash } from 'node:crypto'
import { z } from 'zod'
import type {
  ResearchCoverageDto,
  ResearchEvidenceDto,
  ResearchQuestionDto,
  ResearchRunDto,
  ResearchSourceDto,
  ResearchSourceSnapshotDto,
} from '@shared/deepresearch/contracts'
import type { UpsertResearchEvidenceInput } from '@server/db/repositories/deepresearch/research-evidence.repo'

export const EVIDENCE_PACKET_CHARACTER_BUDGET = 1_200
export const EVIDENCE_PASSAGE_MIN_CHARACTERS = 80
export const EVIDENCE_PASSAGE_MAX_CHARACTERS = 800

const evidenceAnalysisSchema = z.object({
  questionId: z.string().min(1),
  snapshotId: z.string().min(1),
  passage: z.string().min(1).max(EVIDENCE_PASSAGE_MAX_CHARACTERS),
  summary: z.string().trim().min(12).max(1_000),
  stance: z.enum(['supporting', 'contradicting', 'contextual']),
  confidence: z.number().min(0).max(1),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().positive(),
})

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
}

export interface EvidenceAnalyst {
  analyze(input: {
    run: ResearchRunDto
    questions: ResearchQuestionDto[]
    packets: EvidencePacket[]
  }): Promise<EvidenceAnalysis[]>
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
}

export interface EvidenceExtractionResult {
  createdCount: number
  rejectedCount: number
  coverage: ResearchCoverageDto[]
}

const primarySourceTypePattern = /(primary|official|regulatory|filing|peer-reviewed|paper|dataset|survey)/i
const recentSourceAgeMs = 18 * 30 * 24 * 60 * 60 * 1_000

function limitScore(score: number): number {
  return Math.max(0, Math.min(1, Math.round(score * 100) / 100))
}

function coverageThreshold(priority: ResearchQuestionDto['priority']): number {
  if (priority === 'critical') return 0.8
  if (priority === 'high') return 0.7
  if (priority === 'medium') return 0.6
  return 0.5
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

function createSnapshotPackets(
  snapshot: ResearchSourceSnapshotDto,
  source: ResearchSourceDto,
  characterBudget: number,
): EvidencePacket[] {
  const packets: EvidencePacket[] = []
  const content = snapshot.content
  for (let startOffset = 0; startOffset < content.length; startOffset += characterBudget) {
    const endOffset = Math.min(content.length, startOffset + characterBudget)
    const text = content.slice(startOffset, endOffset)
    if (!text.trim()) continue
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
    })
  }
  return packets
}

function idempotencyKey(input: Pick<ResearchEvidenceDto, 'questionId' | 'snapshotId' | 'passage' | 'startOffset' | 'endOffset'>): string {
  return 'evidence:v1:' + createHash('sha256')
    .update([input.questionId, input.snapshotId, input.startOffset, input.endOffset, input.passage].join('\u0000'))
    .digest('hex')
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

  async extract(run: ResearchRunDto, questions: ResearchQuestionDto[]): Promise<EvidenceExtractionResult> {
    const snapshots = new Map(this.options.sourceRepo.listSnapshots(run.id).map((snapshot) => [snapshot.id, snapshot]))
    const packets = this.createPackets(run)
    const packetRanges = new Map<string, Array<Pick<EvidencePacket, 'startOffset' | 'endOffset'>>>()
    for (const packet of packets) {
      const ranges = packetRanges.get(packet.snapshotId) ?? []
      ranges.push(packet)
      packetRanges.set(packet.snapshotId, ranges)
    }
    const knownQuestionIds = new Set(questions.filter((question) => question.runId === run.id).map((question) => question.id))
    const existingEvidenceIds = new Set(this.options.evidenceRepo.list(run.id).map((evidence) => evidence.id))
    const analyses = await this.options.analyst.analyze({ run, questions, packets })
    let createdCount = 0
    let rejectedCount = 0

    for (const candidate of analyses) {
      const parsed = evidenceAnalysisSchema.safeParse(candidate)
      if (!parsed.success) {
        rejectedCount += 1
        continue
      }
      const analysis = parsed.data
      const snapshot = snapshots.get(analysis.snapshotId)
      const passageLength = analysis.endOffset - analysis.startOffset
      const fitsPacket = (packetRanges.get(analysis.snapshotId) ?? []).some((packet) => (
        analysis.startOffset >= packet.startOffset && analysis.endOffset <= packet.endOffset
      ))
      if (
        !knownQuestionIds.has(analysis.questionId)
        || !snapshot
        || snapshot.runId !== run.id
        || analysis.endOffset <= analysis.startOffset
        || passageLength < EVIDENCE_PASSAGE_MIN_CHARACTERS
        || passageLength > EVIDENCE_PASSAGE_MAX_CHARACTERS
        || !fitsPacket
        || snapshot.content.slice(analysis.startOffset, analysis.endOffset) !== analysis.passage
      ) {
        rejectedCount += 1
        continue
      }

      const persisted = this.options.evidenceRepo.upsertEvidence({
        runId: run.id,
        questionId: analysis.questionId,
        snapshotId: analysis.snapshotId,
        passage: analysis.passage,
        summary: analysis.summary,
        stance: analysis.stance,
        confidence: analysis.confidence,
        startOffset: analysis.startOffset,
        endOffset: analysis.endOffset,
        idempotencyKey: idempotencyKey(analysis),
      })
      if (!existingEvidenceIds.has(persisted.id)) {
        existingEvidenceIds.add(persisted.id)
        createdCount += 1
      }
    }

    const coverage = this.assessCoverage(run, questions)
    return { createdCount, rejectedCount, coverage }
  }

  assessCoverage(run: ResearchRunDto, questions: ResearchQuestionDto[]): ResearchCoverageDto[] {
    const sources = new Map(this.options.sourceRepo.listSources(run.id).map((source) => [source.id, source]))
    const snapshots = new Map(this.options.sourceRepo.listSnapshots(run.id).map((snapshot) => [snapshot.id, snapshot]))
    const evidence = this.options.evidenceRepo.list(run.id)
    const now = Date.now()

    return questions
      .filter((question) => question.runId === run.id)
      .map((question) => {
        const questionEvidence = evidence.filter((item) => item.questionId === question.id && snapshots.has(item.snapshotId))
        const associatedSources = questionEvidence
          .map((item) => snapshots.get(item.snapshotId))
          .filter((snapshot): snapshot is ResearchSourceSnapshotDto => Boolean(snapshot))
          .map((snapshot) => sources.get(snapshot.sourceId))
          .filter((source): source is ResearchSourceDto => Boolean(source))
        const distinctSources = [...new Map(associatedSources.map((source) => [source.id, source])).values()]
        const domains = new Set(distinctSources.map((source) => source.domain))
        const categories = [...new Set(distinctSources.map((source) => source.sourceType))].sort()
        const primarySourceCount = distinctSources.filter((source) => primarySourceTypePattern.test(source.sourceType)).length
        const recentSourceCount = distinctSources.filter((source) => source.publishedAt !== null && now - source.publishedAt <= recentSourceAgeMs).length
        const supportingEvidenceCount = questionEvidence.filter((item) => item.stance === 'supporting').length
        const contradictingEvidenceCount = questionEvidence.filter((item) => item.stance === 'contradicting').length
        const hasSingleSourceDependency = questionEvidence.length > 0 && domains.size < 2
        const requiredTypesCovered = question.requiredEvidenceTypes.length === 0
          || question.requiredEvidenceTypes.some((type) => categories.includes(type))
        const score = limitScore(
          (questionEvidence.length > 0 ? 0.2 : 0)
          + (supportingEvidenceCount > 0 ? 0.15 : 0)
          + (requiredTypesCovered ? 0.15 : 0)
          + (domains.size >= 2 ? 0.2 : 0)
          + (primarySourceCount > 0 ? 0.15 : 0)
          + (recentSourceCount > 0 ? 0.1 : 0)
          + (contradictingEvidenceCount > 0 ? 0.05 : 0),
        )
        const gaps: string[] = []
        if (questionEvidence.length === 0) gaps.push('no citable evidence')
        if (!requiredTypesCovered) gaps.push('required evidence category')
        if (domains.size < 2) gaps.push('independent sources')
        if (primarySourceCount === 0) gaps.push('primary or authoritative source')
        if (recentSourceCount === 0) gaps.push('recent source')
        const coverage: ResearchCoverageDto = {
          questionId: question.id,
          score,
          independentDomainCount: domains.size,
          evidenceCategories: categories,
          primarySourceCount,
          recentSourceCount,
          supportingEvidenceCount,
          contradictingEvidenceCount,
          hasSingleSourceDependency,
          gaps,
        }
        const status: ResearchQuestionDto['status'] = score >= coverageThreshold(question.priority) && !hasSingleSourceDependency
          ? 'covered'
          : questionEvidence.length > 0
            ? 'limited'
            : 'researching'
        this.options.questionRepo.updateCoverage(question.id, { coverage, status })
        return coverage
      })
  }
}
