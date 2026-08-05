import type { JsonObject } from './ports'

export type SkillDomainErrorCode =
  | 'NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'INVALID_TRANSITION'
  | 'OWNERSHIP_VIOLATION'
  | 'IDEMPOTENCY_CONFLICT'
  | 'VALIDATION_ERROR'
  | 'FEATURE_DISABLED'

export class SkillDomainError extends Error {
  constructor(
    readonly code: SkillDomainErrorCode,
    message: string,
    readonly details?: JsonObject,
  ) {
    super(message)
    this.name = 'SkillDomainError'
  }
}
