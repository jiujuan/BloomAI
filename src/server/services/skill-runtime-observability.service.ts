import { createSqliteAuditRepository } from '../db/repositories/skill-package.repo'
import {
  getRuntimeDiagnostics,
  getRuntimeHealth,
  type RuntimeDiagnosticsSnapshot,
  type RuntimeHealth,
} from '../skills/observability/skill-runtime.diagnostics'
import type { AuditEventSnapshot, AuditQuery, Page } from '../domain/skill-runtime-ports'

export {
  getRuntimeDiagnostics,
  getRuntimeHealth,
}
export type {
  AuditEventSnapshot,
  AuditQuery,
  Page,
  RuntimeDiagnosticsSnapshot,
  RuntimeHealth,
}

export function createSkillRuntimeAuditReader(): (query: AuditQuery) => Page<AuditEventSnapshot> {
  const auditRepository = createSqliteAuditRepository()
  return (query) => auditRepository.list?.(query) ?? { data: [], total: 0 }
}
