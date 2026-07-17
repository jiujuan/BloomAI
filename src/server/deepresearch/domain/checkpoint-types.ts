import type { ResearchCheckpointCursorDto } from '@shared/deepresearch/contracts'

/** Converts the V1 display-only resume phase to a conservative V2 cursor. */
export function cursorFromLegacyResumePhase(resumePhase: string | null | undefined): ResearchCheckpointCursorDto | null {
  const nextPhase = resumePhase?.trim()
  return nextPhase ? { version: 1, nextPhase, iteration: 0 } : null
}

/** Keeps the legacy field as a projection while checkpoint cursors are the recovery authority. */
export function projectLegacyResumePhase(cursor: ResearchCheckpointCursorDto | null | undefined): string | null {
  return cursor?.nextPhase ?? null
}