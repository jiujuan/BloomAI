import React from 'react'
import type { SkillRuntimeDiagnosticsSnapshot } from '@renderer/pages/Skills/skill-runtime.types'

type Props = {
  diagnostics: SkillRuntimeDiagnosticsSnapshot | null
  loading: boolean
  error: string | null
  onRefresh: () => void
}

export function SkillRuntimeDiagnostics(_props: Props) {
  return null
}
