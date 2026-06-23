import * as vm from 'vm'
import type { ToolExecutor } from './types'

export const nodeRunnerTool: ToolExecutor<{ code: string; context?: object }> = async (input) => {
  const logs: string[] = []
  const sandbox = { ...(input.context || {}), console: { log: (...a: any[]) => logs.push(a.map(String).join(' ')), error: (...a: any[]) => logs.push('[ERR] ' + a.map(String).join(' ')) }, Math, JSON, Date, Array, Object, String, Number, Boolean, parseInt, parseFloat, isNaN, isFinite }
  try {
    const result = vm.runInNewContext(`(function(){ ${input.code} })()`, sandbox, { timeout: 5000, filename: 'skill.js' })
    return { result: result !== undefined ? result : null, logs, success: true }
  } catch (err: any) { return { result: null, logs, error: err.message, success: false } }
}
