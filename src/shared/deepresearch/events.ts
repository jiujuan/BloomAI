import type { JsonObject } from './contracts'

export type ResearchEventType =
  | 'research.run.created'
  | 'research.run.status_changed'
  | 'research.brief.completed'
  | 'research.questions.planned'
  | 'research.query.started'
  | 'research.query.completed'
  | 'research.query.failed'
  | 'research.source.discovered'
  | 'research.source.selected'
  | 'research.source.fetch_failed'
  | 'research.evidence.extracted'
  | 'research.coverage.assessed'
  | 'research.iteration.started'
  | 'research.iteration.completed'
  | 'research.section.drafted'
  | 'research.claim.verified'
  | 'research.quality.assessed'
  | 'research.artifact.created'
  | 'research.run.awaiting_input'
  | 'research.run.completed'
  | 'research.run.failed'
  | 'research.run.cancelled'

interface ResearchEventBase<TType extends ResearchEventType, TPayload extends JsonObject> {
  runId: string
  sequence: number
  type: TType
  phase: string
  timestamp: number
  payload: TPayload
}

type CountPayload = JsonObject & { count: number }
type IdentifierPayload = JsonObject & { id: string }

export type ResearchEvent =
  | ResearchEventBase<'research.run.created', IdentifierPayload>
  | ResearchEventBase<'research.run.status_changed', JsonObject & { from: string; to: string }>
  | ResearchEventBase<'research.brief.completed', IdentifierPayload>
  | ResearchEventBase<'research.questions.planned', CountPayload>
  | ResearchEventBase<'research.query.started', IdentifierPayload>
  | ResearchEventBase<'research.query.completed', IdentifierPayload & { resultCount: number }>
  | ResearchEventBase<'research.query.failed', IdentifierPayload & { errorCode: string }>
  | ResearchEventBase<'research.source.discovered', IdentifierPayload>
  | ResearchEventBase<'research.source.selected', IdentifierPayload>
  | ResearchEventBase<'research.source.fetch_failed', IdentifierPayload & { errorCode: string }>
  | ResearchEventBase<'research.evidence.extracted', CountPayload>
  | ResearchEventBase<'research.coverage.assessed', IdentifierPayload & { score: number }>
  | ResearchEventBase<'research.iteration.started', JsonObject & { iteration: number }>
  | ResearchEventBase<'research.iteration.completed', JsonObject & { iteration: number; newEvidenceCount: number }>
  | ResearchEventBase<'research.section.drafted', IdentifierPayload>
  | ResearchEventBase<'research.claim.verified', IdentifierPayload & { status: string }>
  | ResearchEventBase<'research.quality.assessed', JsonObject & { releaseStatus: string }>
  | ResearchEventBase<'research.artifact.created', IdentifierPayload>
  | ResearchEventBase<'research.run.awaiting_input', JsonObject & { clarificationIds: string[] }>
  | ResearchEventBase<'research.run.completed', JsonObject & { releaseStatus: string }>
  | ResearchEventBase<'research.run.failed', JsonObject & { errorCode: string; retryable: boolean }>
  | ResearchEventBase<'research.run.cancelled', JsonObject>
