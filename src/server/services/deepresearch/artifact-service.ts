import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type {
  ResearchArtifactDto,
  ResearchCitationDto,
  ResearchClaimDto,
  ResearchEvidenceDto,
  ResearchQuestionDto,
  ResearchQualityDto,
  ResearchReportSectionDto,
  ResearchRunDto,
  ResearchSourceDto,
  ResearchSourceSnapshotDto,
} from '@shared/deepresearch/contracts'
import type { UpsertResearchArtifactInput } from '@server/db/repositories/deepresearch/research-report.repo'
import { getDataDir } from '@server/db/paths'

export interface ArtifactWriteInput {
  run: ResearchRunDto
  sections: ResearchReportSectionDto[]
  claims: ResearchClaimDto[]
  citations: ResearchCitationDto[]
  evidence: ResearchEvidenceDto[]
  sources: ResearchSourceDto[]
  snapshots: ResearchSourceSnapshotDto[]
  questions: ResearchQuestionDto[]
  quality: ResearchQualityDto
}

export interface ArtifactServiceOptions {
  reportRepo: { upsertArtifact(input: UpsertResearchArtifactInput): ResearchArtifactDto }
  dataDir?: string
}

function atomicWrite(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = filePath + '.tmp-' + process.pid + '-' + Date.now()
  fs.writeFileSync(temporaryPath, content, 'utf8')
  fs.renameSync(temporaryPath, filePath)
}

function markdown(input: ArtifactWriteInput): string {
  const brief = input.run.brief
  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]))
  const citationsByClaim = new Map<string, ResearchCitationDto[]>()
  for (const citation of input.citations) {
    const current = citationsByClaim.get(citation.claimId) ?? []
    current.push(citation)
    citationsByClaim.set(citation.claimId, current)
  }
  const sections = input.sections.map((section) => {
    const sectionClaims = input.claims.filter((claim) => claim.sectionId === section.id)
    const citationLines = sectionClaims.flatMap((claim) => (citationsByClaim.get(claim.id) ?? []).map((citation) => {
      const evidence = evidenceById.get(citation.evidenceId)
      return '[^' + citation.ordinal + ']: ' + (evidence?.summary ?? 'Bound evidence unavailable.')
    }))
    return '## ' + section.title + '\n\n' + (section.verifiedText ?? section.draft ?? 'Evidence was insufficient for a verified section.')
      + (citationLines.length ? '\n\n' + citationLines.join('\n') : '')
  })
  return [
    '# ' + (brief?.title ?? input.run.topic),
    '',
    '## Scope and method',
    '',
    brief?.scope ?? input.run.topic,
    '',
    'The report was drafted from persisted source snapshots, then claims were checked against bounded evidence passages.',
    '',
    ...sections,
    '',
    '## Limitations',
    '',
    input.quality.limitations.length ? input.quality.limitations.map((item) => '- ' + item).join('\n') : 'No material limitations were identified by the report quality gates.',
    '',
    '## References',
    '',
    input.citations.map((citation) => '[' + citation.ordinal + '] Evidence ' + citation.evidenceId).join('\n') || 'No citations were verified.',
    '',
  ].join('\n')
}

function referenceList(input: ArtifactWriteInput): string {
  const sources = new Map(input.sources.map((source) => [source.id, source]))
  const snapshots = new Map(input.snapshots.map((snapshot) => [snapshot.id, snapshot]))
  const evidence = new Map(input.evidence.map((item) => [item.id, item]))
  return input.citations.map((citation) => {
    const item = evidence.get(citation.evidenceId)
    const source = item ? sources.get(snapshots.get(item.snapshotId)?.sourceId ?? '') : undefined
    return '[' + citation.ordinal + '] ' + (source?.title ?? source?.canonicalUrl ?? citation.evidenceId) + ' (' + (source?.canonicalUrl ?? 'unresolved') + ')'
  }).join('\n') + '\n'
}

export class ArtifactService {
  private readonly dataDir: string

  constructor(private readonly options: ArtifactServiceOptions) {
    this.dataDir = options.dataDir ?? getDataDir()
  }

  write(input: ArtifactWriteInput): ResearchArtifactDto[] {
    const directory = path.join(this.dataDir, 'deepresearch', 'runs', input.run.id)
    const report = {
      runId: input.run.id,
      title: input.run.brief?.title ?? input.run.topic,
      quality: input.quality,
      sections: input.sections,
      claims: input.claims,
      citations: input.citations,
      questions: input.questions,
    }
    const files: Array<{ type: ResearchArtifactDto['type']; fileName: string; contentType: string; content: string }> = [
      { type: 'report_markdown', fileName: 'report.md', contentType: 'text/markdown', content: markdown(input) },
      { type: 'report_json', fileName: 'report.json', contentType: 'application/json', content: JSON.stringify(report, null, 2) + '\n' },
      { type: 'evidence_appendix', fileName: 'evidence-appendix.md', contentType: 'text/markdown', content: input.evidence.map((item) => '## ' + item.id + '\n\n' + item.passage + '\n').join('\n') },
      { type: 'references', fileName: 'references.md', contentType: 'text/markdown', content: referenceList(input) },
      { type: 'run_manifest', fileName: 'run-manifest.json', contentType: 'application/json', content: JSON.stringify({ runId: input.run.id, generatedAt: Date.now(), quality: input.quality, usage: input.run.usage }, null, 2) + '\n' },
    ]
    return files.map((file) => {
      const storagePath = path.join(directory, file.fileName)
      atomicWrite(storagePath, file.content)
      return this.options.reportRepo.upsertArtifact({
        runId: input.run.id,
        type: file.type,
        fileName: file.fileName,
        contentType: file.contentType,
        storagePath,
        sizeBytes: Buffer.byteLength(file.content),
        contentHash: createHash('sha256').update(file.content).digest('hex'),
        metadata: { generated: true },
        idempotencyKey: 'report-artifact:v1:' + file.type,
      })
    })
  }
}
