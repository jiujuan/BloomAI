import type { ResearchEvidenceDto, ResearchSourceDto, ResearchSourceSnapshotDto } from '@shared/deepresearch/contracts'

export interface ResearchSourceContext {
  title: string
  href: string | null
  domain: string | null
}

function metadataString(metadata: ResearchSourceSnapshotDto['metadata'], key: string): string | null {
  const value = metadata[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function evidencePassagePreview(evidence: ResearchEvidenceDto, limit = 150): string {
  const normalized = evidence.passage.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : normalized.slice(0, Math.max(0, limit - 1)).trimEnd() + '?'
}

export function getEvidenceSourceContext(
  evidence: ResearchEvidenceDto,
  snapshotsById: Record<string, ResearchSourceSnapshotDto>,
  sources: ResearchSourceDto[],
): ResearchSourceContext {
  const snapshot = snapshotsById[evidence.snapshotId]
  const source = snapshot ? sources.find((item) => item.id === snapshot.sourceId) : undefined
  const metadataTitle = snapshot ? (metadataString(snapshot.metadata, 'title') ?? metadataString(snapshot.metadata, 'heading')) : null
  const href = snapshot?.finalUrl || source?.canonicalUrl || null
  const domain = source?.domain ?? (href ? (() => { try { return new URL(href).hostname } catch { return null } })() : null)
  return {
    title: source?.title?.trim() || metadataTitle || domain || href || '?????',
    href,
    domain,
  }
}
