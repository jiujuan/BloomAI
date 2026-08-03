import { settingsRepo } from '../db/repositories/settings.repo'
import type { ToolExecutor } from './types'
import {
  fetchBinaryLimited,
  imageMimeFromPath,
  IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  readBinaryFileLimited,
} from './utils/binary-limit'
import { assertNotAborted, resolveToolPath } from './utils/tool-resource'

export const visionTool: ToolExecutor<{ imagePath?: string; imageUrl?: string; question?: string }> = async (input, context) => {
  const apiKey = settingsRepo.getValue('anthropic_api_key') || process.env.ANTHROPIC_API_KEY || ''
  if (!apiKey) throw new Error('Anthropic API key required for vision analysis')
  if ((input.imagePath ? 1 : 0) + (input.imageUrl ? 1 : 0) !== 1) {
    throw new Error('Exactly one of imagePath or imageUrl is required')
  }

  const question = input.question || 'Describe this image in detail.'
  assertNotAborted(context)
  let imageData: string
  let mediaType: string

  if (input.imagePath) {
    const filePath = await resolveToolPath(input.imagePath, context, 'read')
    mediaType = imageMimeFromPath(filePath)
    const binary = await readBinaryFileLimited(filePath, MAX_IMAGE_BYTES, context.signal)
    imageData = Buffer.from(binary.bytes).toString('base64')
  } else if (input.imageUrl) {
    const binary = await fetchBinaryLimited(input.imageUrl, {
      maxBytes: MAX_IMAGE_BYTES,
      signal: context.signal,
      allowedMimeTypes: IMAGE_MIME_TYPES,
    })
    mediaType = binary.contentType
    imageData = Buffer.from(binary.bytes).toString('base64')
  } else {
    throw new Error('imagePath or imageUrl required')
  }

  assertNotAborted(context)
  const requestInit: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageData } },
          { type: 'text', text: question },
        ],
      }],
    }),
  }
  if (context.signal) requestInit.signal = context.signal
  const response = await fetch('https://api.anthropic.com/v1/messages', requestInit)
  const data = await response.json() as { error?: { message?: string }; content?: Array<{ text?: string }> }
  if (!response.ok) throw new Error(data.error?.message || `Vision analysis failed with HTTP ${response.status}`)
  if (data.error) throw new Error(data.error.message)
  return { description: data.content?.[0]?.text || '', model: 'claude-3-5-sonnet-20241022' }
}
