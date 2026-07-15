import type { SkillRunner } from '../types'

export const httpApiRunner: SkillRunner = async (source, input) => {
  let config: any
  try { config = JSON.parse(source) } catch { config = { url: source, method: 'GET' } }
  let url = config.url || ''
  for (const [k, v] of Object.entries(input as Record<string, any>)) url = url.replace(`{{${k}}}`, encodeURIComponent(String(v)))
  const options: RequestInit = { method: config.method || 'GET', headers: config.headers || {}, signal: AbortSignal.timeout(10000) }
  if (config.method === 'POST' && config.body) { options.body = JSON.stringify(config.body); (options.headers as any)['Content-Type'] = 'application/json' }
  const res = await fetch(url, options)
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('json')) return await res.json() as object
  return { text: await res.text(), status: res.status }
}
