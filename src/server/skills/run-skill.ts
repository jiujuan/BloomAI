import { skillRepo } from '../db/repositories/skill.repo'
import { skillRunnerRegistry } from './registry'

export async function runSkill(skillId: string, input: object): Promise<object> {
  const skill = skillRepo.get(skillId)
  if (!skill) throw new Error(`Skill not found: ${skillId}`)
  const run = skillRepo.startRun(skillId, input)
  const start = Date.now()
  try {
    const runner = skillRunnerRegistry[skill.type]
    if (!runner) throw new Error(`Unknown skill type: ${skill.type}`)
    const result = await runner(skill.source, input, { skillId })
    skillRepo.completeRun(run.id, result, Date.now() - start)
    return result
  } catch (err: any) {
    skillRepo.failRun(run.id, err.message, Date.now() - start)
    throw err
  }
}
