export const MIGRATION_ERROR_CODES = {
  MANUAL_REVIEW: 'LEGACY_MIGRATION_MANUAL_REVIEW',
  CRITICAL_BLOCKED: 'LEGACY_MIGRATION_CRITICAL_BLOCKED',
  UNSUPPORTED_TYPE: 'LEGACY_MIGRATION_UNSUPPORTED_TYPE',
  DAMAGED_SCHEMA: 'LEGACY_MIGRATION_DAMAGED_SCHEMA',
  SECRET_REDACTION_FAILED: 'LEGACY_MIGRATION_SECRET_REDACTION_FAILED',
  SOURCE_TOO_LARGE: 'LEGACY_MIGRATION_SOURCE_TOO_LARGE',
  IDEMPOTENCY_CONFLICT: 'LEGACY_MIGRATION_IDEMPOTENCY_CONFLICT',
} as const

export type MigrationErrorCode = (typeof MIGRATION_ERROR_CODES)[keyof typeof MIGRATION_ERROR_CODES]

export class MigrationError extends Error {
  readonly name = 'MigrationError'

  constructor(
    readonly code: MigrationErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, string | number | boolean | null>>,
  ) {
    super(message)
  }
}

export function isMigrationError(error: unknown): error is MigrationError {
  return error instanceof MigrationError
}

export function migrationError(code: MigrationErrorCode, message: string, details?: Readonly<Record<string, string | number | boolean | null>>): MigrationError {
  return new MigrationError(code, message, details)
}
