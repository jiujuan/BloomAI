import { skillRepo } from '../db/repositories/skill.repo'
import { db } from '../db/client'
import * as vm from 'vm'

export async function runSkill(skillId: string, input: object): Promise<object> {
  const skill = skillRepo.get(skillId)
  if (!skill) throw new Error(`Skill not found: ${skillId}`)
  const run = skillRepo.startRun(skillId, input)
  const start = Date.now()
  try {
    let result: object
    switch (skill.type) {
      case 'js-function': result = await runJsFunction(skill.source, input); break
      case 'http-api': result = await runHttpApi(skill.source, input); break
      case 'prompt-template': result = await runPromptTemplate(skill.source, input); break
      default: throw new Error(`Unknown skill type: ${skill.type}`)
    }
    skillRepo.completeRun(run.id, result, Date.now() - start)
    return result
  } catch (err: any) {
    skillRepo.failRun(run.id, err.message, Date.now() - start)
    throw err
  }
}

async function runJsFunction(source: string, input: object): Promise<object> {
  const logs: string[] = []
  const sandbox = { input, console: { log: (...a: any[]) => logs.push(a.join(' ')), error: (...a: any[]) => logs.push('[err] ' + a.join(' ')) }, Math, JSON, Date, Array, Object, String, Number, Boolean, parseInt, parseFloat, isNaN, isFinite, result: undefined as any }
  vm.runInNewContext(`${source}\nresult = typeof run === 'function' ? run(input) : input;`, sandbox, { timeout: 5000 })
  const r = sandbox.result
  if (r && typeof r === 'object') return { ...r, _logs: logs }
  return { result: r, _logs: logs }
}

async function runHttpApi(configJson: string, input: object): Promise<object> {
  let config: any
  try { config = JSON.parse(configJson) } catch { config = { url: configJson, method: 'GET' } }
  let url = config.url || ''
  for (const [k, v] of Object.entries(input as Record<string, any>)) url = url.replace(`{{${k}}}`, encodeURIComponent(String(v)))
  const options: RequestInit = { method: config.method || 'GET', headers: config.headers || {}, signal: AbortSignal.timeout(10000) }
  if (config.method === 'POST' && config.body) { options.body = JSON.stringify(config.body); (options.headers as any)['Content-Type'] = 'application/json' }
  const res = await fetch(url, options)
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('json')) return await res.json() as object
  return { text: await res.text(), status: res.status }
}

async function runPromptTemplate(template: string, input: object): Promise<object> {
  let prompt = template
  for (const [k, v] of Object.entries(input as Record<string, any>)) prompt = prompt.replace(new RegExp(`{{${k}}}`, 'g'), String(v))
  const apiKeyRow = db.prepare("SELECT value FROM settings WHERE key='anthropic_api_key'").get() as any
  const apiKey = apiKeyRow?.value || process.env.ANTHROPIC_API_KEY || ''
  if (!apiKey) throw new Error('Anthropic API key required for prompt-template skills')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-3-haiku-20240307', max_tokens: 2048, messages: [{ role: 'user', content: prompt }] })
  })
  const data = await res.json() as any
  if (data.error) throw new Error(data.error.message)
  return { output: data.content?.[0]?.text || '', prompt }
}
