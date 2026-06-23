import * as fs from 'fs'
import * as path from 'path'
import { db } from '../db/client'
import type { ToolExecutor } from './types'
import { resolveSafePath } from './utils/path'

export const visionTool: ToolExecutor<{ imagePath?: string; imageUrl?: string; question?: string }> = async (input) => {
  const apiKeyRow = db.prepare("SELECT value FROM settings WHERE key='anthropic_api_key'").get() as any
  const apiKey = apiKeyRow?.value || process.env.ANTHROPIC_API_KEY || ''
  if (!apiKey) throw new Error('Anthropic API key required for vision analysis')
  const question = input.question || 'Describe this image in detail.'
  let imageData: string; let mediaType: string
  if (input.imagePath) {
    const filePath = resolveSafePath(input.imagePath)
    imageData = fs.readFileSync(filePath).toString('base64')
    const ext = path.extname(filePath).toLowerCase()
    mediaType = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
  } else if (input.imageUrl) {
    const res = await fetch(input.imageUrl, { signal: AbortSignal.timeout(10000) })
    imageData = Buffer.from(await res.arrayBuffer()).toString('base64')
    mediaType = res.headers.get('content-type') || 'image/jpeg'
  } else throw new Error('imagePath or imageUrl required')
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-3-5-sonnet-20241022', max_tokens: 1024, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: imageData } }, { type: 'text', text: question }] }] })
  })
  const data = await response.json() as any
  if (data.error) throw new Error(data.error.message)
  return { description: data.content?.[0]?.text || '', model: 'claude-3-5-sonnet-20241022' }
}
