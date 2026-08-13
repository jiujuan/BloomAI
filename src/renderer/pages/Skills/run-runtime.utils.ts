import type { SkillRunEvent } from './skill-runtime.types'

export function serializeRunEvents(events: SkillRunEvent[]) {
  return JSON.stringify(
    { exportedAt: new Date().toISOString(), events },
    null,
    2,
  )
}
