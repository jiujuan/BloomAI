import * as vm from 'vm'
import type { SkillRunner } from './types'

export const jsFunctionRunner: SkillRunner = async (source, input) => {
  const logs: string[] = []
  const sandbox = { input, console: { log: (...a: any[]) => logs.push(a.join(' ')), error: (...a: any[]) => logs.push('[err] ' + a.join(' ')) }, Math, JSON, Date, Array, Object, String, Number, Boolean, parseInt, parseFloat, isNaN, isFinite, result: undefined as any }
  vm.runInNewContext(`${source}\nresult = typeof run === 'function' ? run(input) : input;`, sandbox, { timeout: 5000 })
  const r = sandbox.result
  if (r && typeof r === 'object') return { ...r, _logs: logs }
  return { result: r, _logs: logs }
}
