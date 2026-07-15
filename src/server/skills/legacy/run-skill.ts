import { skillRepo } from '../../db/repositories/skill.repo'
import { skillRunnerRegistry } from './registry'
import { resolveLegacySkillId } from '../identifiers'

export async function runSkill(skillId: string, input: object): Promise<object> {
  const legacySkillId = resolveLegacySkillId(skillId)
  if (!legacySkillId) throw new Error('Package Skill references cannot run through the Legacy runtime')
  const skill = skillRepo.get(legacySkillId)
  if (!skill) throw new Error(`Skill not found: ${skillId}`)
  const run = skillRepo.startRun(legacySkillId, input)
  const start = Date.now()
  try {
    const runner = skillRunnerRegistry[skill.type]
    if (!runner) throw new Error(`Unknown skill type: ${skill.type}`)
    const result = await runner(skill.source, input, { skillId: legacySkillId })
    skillRepo.completeRun(run.id, result, Date.now() - start)
    return result
  } catch (err: any) {
    skillRepo.failRun(run.id, err.message, Date.now() - start)
    throw err
  }
}
