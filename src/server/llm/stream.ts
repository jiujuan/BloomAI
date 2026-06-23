import { LlmResponseParseError } from './errors'
import type { OllamaStreamParseResult, OpenAIStreamParseResult } from './types'

export function parseOpenAICompatibleSseLine(line: string): OpenAIStreamParseResult {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith(':')) return { type: 'ignore' }
  if (!trimmed.startsWith('data:')) return { type: 'ignore' }

  const data = trimmed.slice('data:'.length).trim()
  if (!data) return { type: 'ignore' }
  if (data === '[DONE]') return { type: 'done' }

  let payload: unknown
  try {
    payload = JSON.parse(data)
  } catch (error) {
    throw new LlmResponseParseError('Unable to parse OpenAI-compatible stream line', { cause: error })
  }

  if (!payload || typeof payload !== 'object') return { type: 'ignore' }
  const record = payload as Record<string, any>
  const delta = record.choices?.[0]?.delta?.content
  if (typeof delta === 'string' && delta.length > 0) {
    return { type: 'delta', text: delta }
  }

  const promptTokens = record.usage?.prompt_tokens
  const completionTokens = record.usage?.completion_tokens
  if (typeof promptTokens === 'number' && typeof completionTokens === 'number') {
    return { type: 'usage', input: promptTokens, output: completionTokens }
  }

  return { type: 'ignore' }
}

export function parseOllamaNdjsonLine(line: string): OllamaStreamParseResult {
  const trimmed = line.trim()
  if (!trimmed) return { type: 'ignore' }

  let payload: unknown
  try {
    payload = JSON.parse(trimmed)
  } catch (error) {
    throw new LlmResponseParseError('Unable to parse Ollama stream line', { cause: error })
  }

  if (!payload || typeof payload !== 'object') return { type: 'ignore' }
  const record = payload as Record<string, any>
  if (record.done === true) return { type: 'done' }

  const text = record.message?.content
  if (typeof text === 'string' && text.length > 0) {
    return { type: 'delta', text }
  }

  return { type: 'ignore' }
}
