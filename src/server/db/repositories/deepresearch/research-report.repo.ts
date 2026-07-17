import { and, asc, eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import type {
  JsonValue,
  ResearchArtifactDto,
  ResearchCitationDto,
  ResearchClaimDto,
  ResearchQualityDto,
  ResearchReportSectionDto,
} from '@shared/deepresearch/contracts'
import { getOrmDb } from '../../client'
import {
  research_artifacts,
  research_citations,
  research_claims,
  research_quality_assessments,
  research_report_sections,
} from '../../schema'
import { decodeJson, encodeJson } from './repository-utils'

export interface UpsertResearchSectionInput {
  runId: string
  ordinal: number
  title: string
  purpose: string
  draft?: string | null
  verifiedText?: string | null
  status: ResearchReportSectionDto['status']
  idempotencyKey: string
}

export interface UpsertResearchClaimInput {
  runId: string
  sectionId: string
  text: string
  kind: ResearchClaimDto['kind']
  importance: ResearchClaimDto['importance']
  verificationStatus: ResearchClaimDto['verificationStatus']
  confidence: number
  repairHistory: JsonValue[]
  idempotencyKey: string
}

export interface UpsertResearchCitationInput {
  runId: string
  claimId: string
  evidenceId: string
  entailmentStatus: ResearchCitationDto['entailmentStatus']
  rationale: string
}

export interface UpdateResearchSectionInput {
  draft?: string | null
  verifiedText?: string | null
  status?: ResearchReportSectionDto['status']
}

export interface UpdateResearchClaimInput {
  verificationStatus?: ResearchClaimDto['verificationStatus']
  repairHistory?: JsonValue[]
}

export interface UpdateResearchCitationInput {
  entailmentStatus?: ResearchCitationDto['entailmentStatus']
  rationale?: string
}

export interface UpsertResearchArtifactInput {
  runId: string
  type: ResearchArtifactDto['type']
  fileName: string
  contentType: string
  storagePath: string
  sizeBytes: number
  contentHash?: string | null
  metadata?: object
  idempotencyKey: string
}

export interface StoredResearchArtifact {
  artifact: ResearchArtifactDto
  storagePath: string
}

export function mapResearchSection(row: typeof research_report_sections.$inferSelect): ResearchReportSectionDto {
  return {
    id: row.id,
    runId: row.run_id,
    ordinal: row.ordinal,
    title: row.title,
    purpose: row.purpose,
    draft: row.draft,
    verifiedText: row.verified_text,
    status: row.status as ResearchReportSectionDto['status'],
  }
}

export function mapResearchClaim(row: typeof research_claims.$inferSelect): ResearchClaimDto {
  return {
    id: row.id,
    runId: row.run_id,
    sectionId: row.section_id,
    text: row.text,
    kind: row.kind as ResearchClaimDto['kind'],
    importance: row.importance as ResearchClaimDto['importance'],
    verificationStatus: row.verification_status as ResearchClaimDto['verificationStatus'],
    confidence: row.confidence,
    repairHistory: decodeJson<JsonValue[]>(row.repair_history_json, []),
  }
}

export function mapResearchCitation(row: typeof research_citations.$inferSelect): ResearchCitationDto {
  return {
    id: row.id,
    runId: row.run_id,
    claimId: row.claim_id,
    evidenceId: row.evidence_id,
    entailmentStatus: row.entailment_status as ResearchCitationDto['entailmentStatus'],
    rationale: row.rationale,
    ordinal: row.ordinal,
  }
}

export function mapResearchArtifact(row: typeof research_artifacts.$inferSelect): ResearchArtifactDto {
  return {
    id: row.id,
    runId: row.run_id,
    type: row.type as ResearchArtifactDto['type'],
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  }
}

export function mapResearchQuality(row: typeof research_quality_assessments.$inferSelect): ResearchQualityDto {
  return {
    releaseStatus: row.release_status as ResearchQualityDto['releaseStatus'],
    highPriorityQuestionCoverage: row.high_priority_question_coverage,
    factualClaimCitationCoverage: row.factual_claim_citation_coverage,
    supportedCitationCoverage: row.supported_citation_coverage,
    independentCitedDomainCount: row.independent_cited_domain_count,
    contradictionDisclosureCoverage: row.contradiction_disclosure_coverage,
    requiredSectionCoverage: row.required_section_coverage,
    limitations: decodeJson<string[]>(row.limitations_json, []),
    assessorVersion: row.assessor_version,
  }
}

export const researchReportRepo = {
  upsertSection(input: UpsertResearchSectionInput): ResearchReportSectionDto {
    return getOrmDb().transaction((tx) => {
      const existing = tx.select().from(research_report_sections).where(and(
        eq(research_report_sections.run_id, input.runId),
        eq(research_report_sections.idempotency_key, input.idempotencyKey),
      )).get()
      if (existing) return mapResearchSection(existing)

      const id = uuidv4()
      const now = Date.now()
      tx.insert(research_report_sections).values({
        id,
        run_id: input.runId,
        ordinal: input.ordinal,
        title: input.title,
        purpose: input.purpose,
        draft: input.draft ?? null,
        verified_text: input.verifiedText ?? null,
        status: input.status,
        idempotency_key: input.idempotencyKey,
        created_at: now,
        updated_at: now,
      }).run()
      return mapResearchSection(tx.select().from(research_report_sections).where(eq(research_report_sections.id, id)).get()!)
    })
  },

  upsertClaim(input: UpsertResearchClaimInput): ResearchClaimDto {
    return getOrmDb().transaction((tx) => {
      const existing = tx.select().from(research_claims).where(and(
        eq(research_claims.run_id, input.runId),
        eq(research_claims.idempotency_key, input.idempotencyKey),
      )).get()
      if (existing) return mapResearchClaim(existing)

      const id = uuidv4()
      const now = Date.now()
      tx.insert(research_claims).values({
        id,
        run_id: input.runId,
        section_id: input.sectionId,
        text: input.text,
        kind: input.kind,
        importance: input.importance,
        verification_status: input.verificationStatus,
        confidence: input.confidence,
        repair_history_json: encodeJson(input.repairHistory),
        idempotency_key: input.idempotencyKey,
        created_at: now,
        updated_at: now,
      }).run()
      return mapResearchClaim(tx.select().from(research_claims).where(eq(research_claims.id, id)).get()!)
    })
  },

  updateSection(id: string, data: UpdateResearchSectionInput): ResearchReportSectionDto {
    const updates: Partial<typeof research_report_sections.$inferInsert> = { updated_at: Date.now() }
    if (data.draft !== undefined) updates.draft = data.draft
    if (data.verifiedText !== undefined) updates.verified_text = data.verifiedText
    if (data.status !== undefined) updates.status = data.status
    const result = getOrmDb().update(research_report_sections).set(updates).where(eq(research_report_sections.id, id)).run()
    if (result.changes !== 1) throw new Error('Deep Research report section not found: ' + id)
    return mapResearchSection(getOrmDb().select().from(research_report_sections).where(eq(research_report_sections.id, id)).get()!)
  },

  updateClaim(id: string, data: UpdateResearchClaimInput): ResearchClaimDto {
    const updates: Partial<typeof research_claims.$inferInsert> = { updated_at: Date.now() }
    if (data.verificationStatus !== undefined) updates.verification_status = data.verificationStatus
    if (data.repairHistory !== undefined) updates.repair_history_json = encodeJson(data.repairHistory)
    const result = getOrmDb().update(research_claims).set(updates).where(eq(research_claims.id, id)).run()
    if (result.changes !== 1) throw new Error('Deep Research claim not found: ' + id)
    return mapResearchClaim(getOrmDb().select().from(research_claims).where(eq(research_claims.id, id)).get()!)
  },

  updateCitation(id: string, data: UpdateResearchCitationInput): ResearchCitationDto {
    const updates: Partial<typeof research_citations.$inferInsert> = {}
    if (data.entailmentStatus !== undefined) updates.entailment_status = data.entailmentStatus
    if (data.rationale !== undefined) updates.rationale = data.rationale
    const result = getOrmDb().update(research_citations).set(updates).where(eq(research_citations.id, id)).run()
    if (result.changes !== 1) throw new Error('Deep Research citation not found: ' + id)
    return mapResearchCitation(getOrmDb().select().from(research_citations).where(eq(research_citations.id, id)).get()!)
  },

  upsertCitation(input: UpsertResearchCitationInput): ResearchCitationDto {
    return getOrmDb().transaction((tx) => {
      const existing = tx.select().from(research_citations).where(and(
        eq(research_citations.run_id, input.runId),
        eq(research_citations.claim_id, input.claimId),
        eq(research_citations.evidence_id, input.evidenceId),
      )).get()
      if (existing) return mapResearchCitation(existing)

      const maxOrdinal = tx
        .select({ ordinal: sql<number>`coalesce(max(${research_citations.ordinal}), 0)` })
        .from(research_citations)
        .where(eq(research_citations.run_id, input.runId))
        .get()
      const id = uuidv4()
      const ordinal = Number(maxOrdinal?.ordinal ?? 0) + 1
      tx.insert(research_citations).values({
        id,
        run_id: input.runId,
        claim_id: input.claimId,
        evidence_id: input.evidenceId,
        entailment_status: input.entailmentStatus,
        rationale: input.rationale,
        ordinal,
        created_at: Date.now(),
      }).run()
      return mapResearchCitation(tx.select().from(research_citations).where(eq(research_citations.id, id)).get()!)
    })
  },

  upsertArtifact(input: UpsertResearchArtifactInput): ResearchArtifactDto {
    return getOrmDb().transaction((tx) => {
      const existing = tx.select().from(research_artifacts).where(and(
        eq(research_artifacts.run_id, input.runId),
        eq(research_artifacts.idempotency_key, input.idempotencyKey),
      )).get()
      if (existing) return mapResearchArtifact(existing)

      const id = uuidv4()
      tx.insert(research_artifacts).values({
        id,
        run_id: input.runId,
        type: input.type,
        file_name: input.fileName,
        content_type: input.contentType,
        storage_path: input.storagePath,
        size_bytes: input.sizeBytes,
        content_hash: input.contentHash ?? null,
        metadata_json: encodeJson(input.metadata ?? {}),
        idempotency_key: input.idempotencyKey,
        created_at: Date.now(),
      }).run()
      return mapResearchArtifact(tx.select().from(research_artifacts).where(eq(research_artifacts.id, id)).get()!)
    })
  },

  createQuality(runId: string, quality: ResearchQualityDto): ResearchQualityDto {
    const id = uuidv4()
    getOrmDb().insert(research_quality_assessments).values({
      id,
      run_id: runId,
      release_status: quality.releaseStatus,
      high_priority_question_coverage: quality.highPriorityQuestionCoverage,
      factual_claim_citation_coverage: quality.factualClaimCitationCoverage,
      supported_citation_coverage: quality.supportedCitationCoverage,
      independent_cited_domain_count: quality.independentCitedDomainCount,
      contradiction_disclosure_coverage: quality.contradictionDisclosureCoverage,
      required_section_coverage: quality.requiredSectionCoverage,
      limitations_json: encodeJson(quality.limitations),
      assessor_version: quality.assessorVersion,
      created_at: Date.now(),
    }).run()
    return quality
  },

  listSections(runId: string): ResearchReportSectionDto[] {
    return getOrmDb().select().from(research_report_sections).where(eq(research_report_sections.run_id, runId)).orderBy(asc(research_report_sections.ordinal)).all().map(mapResearchSection)
  },

  listClaims(runId: string): ResearchClaimDto[] {
    return getOrmDb().select().from(research_claims).where(eq(research_claims.run_id, runId)).orderBy(asc(research_claims.created_at)).all().map(mapResearchClaim)
  },

  listCitations(runId: string): ResearchCitationDto[] {
    return getOrmDb().select().from(research_citations).where(eq(research_citations.run_id, runId)).orderBy(asc(research_citations.ordinal)).all().map(mapResearchCitation)
  },

  listArtifacts(runId: string): ResearchArtifactDto[] {
    return getOrmDb().select().from(research_artifacts).where(eq(research_artifacts.run_id, runId)).orderBy(asc(research_artifacts.created_at)).all().map(mapResearchArtifact)
  },

  getStoredArtifact(runId: string, artifactId: string): StoredResearchArtifact | undefined {
    const row = getOrmDb().select().from(research_artifacts).where(and(
      eq(research_artifacts.run_id, runId),
      eq(research_artifacts.id, artifactId),
    )).get()
    return row ? { artifact: mapResearchArtifact(row), storagePath: row.storage_path } : undefined
  },
}
