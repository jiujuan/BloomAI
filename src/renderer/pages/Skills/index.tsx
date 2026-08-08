import React from 'react'
import { SkillsCenterWorkbench } from './SkillsCenterWorkbench'

export { SkillsCenterWorkbench } from './SkillsCenterWorkbench'

export function SkillsAdminShell() {
  return <SkillsCenterWorkbench />
}

/** Compatibility export for callers that still use the old component name. */
export function SkillsMarket() {
  return <SkillsAdminShell />
}
