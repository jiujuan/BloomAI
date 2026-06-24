import { settingsRepo } from '../db/repositories/settings.repo'
import type { SkillRunner } from './types'

export const promptTemplateRunner: SkillRunner = async (template, input) => {
  let prompt = template
  for (const [k, v] of Object.entries(input as Record<string, any>)) prompt = prompt.replace(new RegExp(`{{${k}}}`, 'g'), String(v))
  const apiKey = settingsRepo.getValue('anthropic_api_key') || process.env.ANTHROPIC_API_KEY || ''
  if (!apiKey) throw new Error('Anthropic API key required for prompt-template skills')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-3-haiku-20240307', max_tokens: 2048, messages: [{ role: 'user', content: prompt }] })
  })
  const data = await res.json() as any
  if (data.error) throw new Error(data.error.message)
  return { output: data.content?.[0]?.text || '', prompt }
}
