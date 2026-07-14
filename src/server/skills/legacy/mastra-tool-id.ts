/** Mastra tool namespace for the synchronous Legacy Skill runtime. */
export function toLegacySkillToolId(skillId: string): string {
  return `legacy_skill_${skillId}`
}
