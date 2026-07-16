import { and, asc, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import type { JsonObject, ResearchSourceDto, ResearchSourceSnapshotDto } from '@shared/deepresearch/contracts'
import { getOrmDb } from '../../client'
import { research_source_snapshots, research_sources } from '../../schema'
import { decodeJson, EMPTY_JSON_OBJECT, encodeJson } from './repository-utils'

export interface CreateResearchSourceInput {
  runId: string
  canonicalUrl: string
  domain: string
  title?: string | null
  author?: string | null
  publisher?: string | null
  publishedAt?: number | null
  sourceType: string
  selectionStatus: ResearchSourceDto['selectionStatus']
  scores: JsonObject
}

export interface CreateResearchSnapshotInput {
  runId: string
  sourceId: string
  contentHash: string
  content: string
  metadata: JsonObject
  fetchedAt: number
  parserVersion: string
  finalUrl: string
  httpStatus?: number | null
  idempotencyKey: string
}

export function mapResearchSource(row: typeof research_sources.$inferSelect): ResearchSourceDto {
  return {
    id: row.id,
    runId: row.run_id,
    canonicalUrl: row.canonical_url,
    domain: row.domain,
    title: row.title,
    author: row.author,
    publisher: row.publisher,
    publishedAt: row.published_at,
    sourceType: row.source_type,
    selectionStatus: row.selection_status as ResearchSourceDto['selectionStatus'],
    scores: decodeJson<JsonObject>(row.scores_json, EMPTY_JSON_OBJECT),
  }
}

export function mapResearchSnapshot(row: typeof research_source_snapshots.$inferSelect): ResearchSourceSnapshotDto {
  return {
    id: row.id,
    runId: row.run_id,
    sourceId: row.source_id,
    contentHash: row.content_hash,
    content: row.content,
    metadata: decodeJson<JsonObject>(row.metadata_json, EMPTY_JSON_OBJECT),
    fetchedAt: row.fetched_at,
    parserVersion: row.parser_version,
    finalUrl: row.final_url,
    httpStatus: row.http_status,
  }
}

export const researchSourceRepo = {
  createSource(input: CreateResearchSourceInput): ResearchSourceDto {
    const id = uuidv4()
    const now = Date.now()
    getOrmDb().insert(research_sources).values({
      id,
      run_id: input.runId,
      canonical_url: input.canonicalUrl,
      domain: input.domain,
      title: input.title ?? null,
      author: input.author ?? null,
      publisher: input.publisher ?? null,
      published_at: input.publishedAt ?? null,
      source_type: input.sourceType,
      selection_status: input.selectionStatus,
      scores_json: encodeJson(input.scores),
      created_at: now,
      updated_at: now,
    }).run()

    return this.getSource(id)!
  },

  getSource(id: string): ResearchSourceDto | undefined {
    const row = getOrmDb().select().from(research_sources).where(eq(research_sources.id, id)).get()
    return row ? mapResearchSource(row) : undefined
  },

  getByCanonicalUrl(runId: string, canonicalUrl: string): ResearchSourceDto | undefined {
    const row = getOrmDb()
      .select()
      .from(research_sources)
      .where(and(eq(research_sources.run_id, runId), eq(research_sources.canonical_url, canonicalUrl)))
      .get()
    return row ? mapResearchSource(row) : undefined
  },

  listSources(runId: string): ResearchSourceDto[] {
    return getOrmDb()
      .select()
      .from(research_sources)
      .where(eq(research_sources.run_id, runId))
      .orderBy(asc(research_sources.created_at))
      .all()
      .map(mapResearchSource)
  },

  createSnapshot(input: CreateResearchSnapshotInput): ResearchSourceSnapshotDto {
    return getOrmDb().transaction((tx) => {
      const existing = tx
        .select()
        .from(research_source_snapshots)
        .where(and(
          eq(research_source_snapshots.run_id, input.runId),
          eq(research_source_snapshots.idempotency_key, input.idempotencyKey),
        ))
        .get()
      if (existing) return mapResearchSnapshot(existing)

      const id = uuidv4()
      tx.insert(research_source_snapshots).values({
        id,
        run_id: input.runId,
        source_id: input.sourceId,
        content_hash: input.contentHash,
        content: input.content,
        metadata_json: encodeJson(input.metadata),
        fetched_at: input.fetchedAt,
        parser_version: input.parserVersion,
        final_url: input.finalUrl,
        http_status: input.httpStatus ?? null,
        idempotency_key: input.idempotencyKey,
        created_at: Date.now(),
      }).run()

      return mapResearchSnapshot(tx.select().from(research_source_snapshots).where(eq(research_source_snapshots.id, id)).get()!)
    })
  },

  listSnapshots(runId: string): ResearchSourceSnapshotDto[] {
    return getOrmDb()
      .select()
      .from(research_source_snapshots)
      .where(eq(research_source_snapshots.run_id, runId))
      .orderBy(asc(research_source_snapshots.fetched_at))
      .all()
      .map(mapResearchSnapshot)
  },
}
