export type SkillRunner = (
  source: string,
  input: object,
  context: SkillExecutionContext
) => Promise<object> | object

export interface SkillExecutionContext {
  skillId: string
}
