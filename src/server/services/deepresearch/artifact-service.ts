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

export interface ArtifactReconciliationManifest {
  version: 1
  runId: string
  attemptId: string
  type: ResearchArtifactDto['type']
  fileName: string
  contentHash: string
  fingerprint: string
  generatedAt: number
  registrationState: 'pending' | 'registered'
}

export function artifactReconciliationFingerprint(input: Pick<ArtifactReconciliationManifest, 'runId' | 'attemptId' | 'type' | 'fileName' | 'contentHash' | 'generatedAt'>): string {
  return createHash('sha256').update([input.runId, input.attemptId, input.type, input.fileName, input.contentHash, String(input.generatedAt)].join('\n')).digest('hex')
}

export function artifactManifestPath(storagePath: string): string {
  return storagePath + '.reconciliation.json'
}

export function readArtifactReconciliationManifest(storagePath: string): ArtifactReconciliationManifest | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(artifactManifestPath(storagePath), 'utf8')) as Partial<ArtifactReconciliationManifest>
    if (parsed.version !== 1 || typeof parsed.runId !== 'string' || typeof parsed.attemptId !== 'string' || typeof parsed.type !== 'string' || typeof parsed.fileName !== 'string' || typeof parsed.contentHash !== 'string' || typeof parsed.fingerprint !== 'string' || typeof parsed.generatedAt !== 'number' || (parsed.registrationState !== 'pending' && parsed.registrationState !== 'registered')) return null
    return parsed as ArtifactReconciliationManifest
  } catch {
    return null
  }
}

export function verifyArtifactReconciliationManifest(storagePath: string, manifest: ArtifactReconciliationManifest): boolean {
  try {
    const stat = fs.statSync(storagePath)
    if (!stat.isFile() || stat.size <= 0 || path.basename(storagePath) !== manifest.fileName) return false
    const contentHash = createHash('sha256').update(fs.readFileSync(storagePath)).digest('hex')
    return contentHash === manifest.contentHash
      && manifest.fingerprint === artifactReconciliationFingerprint(manifest)
  } catch {
    return false
  }
}


function atomicWrite(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = filePath + '.tmp-' + process.pid + '-' + Date.now()
  fs.writeFileSync(temporaryPath, content, 'utf8')
  fs.renameSync(temporaryPath, filePath)
}

export function createReportMarkdown(input: ArtifactWriteInput): string {
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
    formatReferences(input, 'markdown') || 'No citations were verified.',
    '',
  ].join('\n')
}

function escapeMarkdownLinkLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]')
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function escapeMarkdownLinkUrl(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function formatReferences(input: ArtifactWriteInput, format: 'markdown' | 'plain'): string {
  const sources = new Map(input.sources.map((source) => [source.id, source]))
  const snapshots = new Map(input.snapshots.map((snapshot) => [snapshot.id, snapshot]))
  const evidence = new Map(input.evidence.map((item) => [item.id, item]))
  return input.citations.map((citation) => {
    const item = evidence.get(citation.evidenceId)
    const source = item ? sources.get(snapshots.get(item.snapshotId)?.sourceId ?? '') : undefined
    const url = source?.canonicalUrl
    const title = source?.title ?? url
    if (!title || !url || !isHttpUrl(url)) return '[' + citation.ordinal + '] Bound source unavailable.'
    return format === 'markdown'
      ? '[' + citation.ordinal + '] [' + escapeMarkdownLinkLabel(title) + '](' + escapeMarkdownLinkUrl(url) + ')'
      : '[' + citation.ordinal + '] ' + title + ' (' + url + ')'
  }).join('\n')
}

function referenceList(input: ArtifactWriteInput): string {
  return formatReferences(input, 'plain') + '\n'
}

export class ArtifactService {
  private readonly dataDir: string

  constructor(private readonly options: ArtifactServiceOptions) {
    this.dataDir = options.dataDir ?? getDataDir()
  }

  private persistArtifactWithManifest(input: UpsertResearchArtifactInput, content: string, attemptId: string | null): ResearchArtifactDto {
    const contentHash = createHash('sha256').update(content).digest('hex')
    const generatedAt = Date.now()
    const manifest = attemptId ? {
      version: 1 as const,
      runId: input.runId,
      attemptId,
      type: input.type,
      fileName: input.fileName,
      contentHash,
      generatedAt,
      fingerprint: artifactReconciliationFingerprint({ runId: input.runId, attemptId, type: input.type, fileName: input.fileName, contentHash, generatedAt }),
      registrationState: 'pending' as const,
    } : null
    if (manifest) atomicWrite(artifactManifestPath(input.storagePath), JSON.stringify(manifest) + '\n')
    const artifact = this.options.reportRepo.upsertArtifact({
      ...input,
      contentHash,
      metadata: { ...input.metadata, generated: true, reconciliation: manifest ? { attemptId: manifest.attemptId, fingerprint: manifest.fingerprint, generatedAt: manifest.generatedAt, registrationState: 'registered' } : undefined },
    })
    if (manifest) atomicWrite(artifactManifestPath(input.storagePath), JSON.stringify({ ...manifest, registrationState: 'registered' }) + '\n')
    return artifact
  }

  writeChineseMarkdown(runId: string, markdown: string): ResearchArtifactDto {
    const directory = path.join(this.dataDir, 'deepresearch', 'runs', runId)
    const fileName = 'report.zh-CN.md'
    const storagePath = path.join(directory, fileName)
    atomicWrite(storagePath, markdown)
    return this.options.reportRepo.upsertArtifact({
      runId,
      type: 'report_markdown_zh_cn',
      fileName,
      contentType: 'text/markdown',
      storagePath,
      sizeBytes: Buffer.byteLength(markdown),
      contentHash: createHash('sha256').update(markdown).digest('hex'),
      metadata: { generated: true, language: 'zh-CN', sourceLanguage: 'en' },
      idempotencyKey: 'report-artifact:v1:report_markdown_zh_cn',
    })
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
      { type: 'report_markdown', fileName: 'report.md', contentType: 'text/markdown', content: createReportMarkdown(input) },
      { type: 'report_json', fileName: 'report.json', contentType: 'application/json', content: JSON.stringify(report, null, 2) + '\n' },
      { type: 'evidence_appendix', fileName: 'evidence-appendix.md', contentType: 'text/markdown', content: input.evidence.map((item) => '## ' + item.id + '\n\n' + item.passage + '\n').join('\n') },
      { type: 'references', fileName: 'references.md', contentType: 'text/markdown', content: referenceList(input) },
      { type: 'run_manifest', fileName: 'run-manifest.json', contentType: 'application/json', content: JSON.stringify({ runId: input.run.id, generatedAt: Date.now(), quality: input.quality, usage: input.run.usage }, null, 2) + '\n' },
    ]
    return files.map((file) => {
      const storagePath = path.join(directory, file.fileName)
      atomicWrite(storagePath, file.content)
      return this.persistArtifactWithManifest({
        runId: input.run.id,
        type: file.type,
        fileName: file.fileName,
        contentType: file.contentType,
        storagePath,
        sizeBytes: Buffer.byteLength(file.content),
        metadata: { generated: true },
        idempotencyKey: 'report-artifact:v1:' + file.type,
      }, file.content, input.run.currentAttemptId ?? null)
    })
  }
}
