import { LlmProviderError } from '../errors'
import { getProviderApiKey, getProviderBaseUrl } from '../settings'
import { parseOpenAICompatibleSseLine } from '../stream'
import type { ChatProvider, LlmMessage, ResolvedLlmModel } from '../types'

function isRequestMessage(message: LlmMessage): message is LlmMessage & { role: 'user' | 'assistant' } {
  return message.role === 'user' || message.role === 'assistant'
}

function getChatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'OpenAI-compatible request failed'
}

export function createOpenAICompatibleProvider(resolved: ResolvedLlmModel): ChatProvider {
  return {
    async *streamChat(input) {
      const apiKey = getProviderApiKey(resolved.provider)
      const baseUrl = getProviderBaseUrl(resolved.provider)
      const messages = [
        ...(input.system ? [{ role: 'system' as const, content: input.system }] : []),
        ...input.messages.filter(isRequestMessage).map((message) => ({
          role: message.role,
          content: message.content,
        })),
      ]

      let response: Response
      try {
        response = await fetch(getChatCompletionsUrl(baseUrl), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: resolved.model.modelId,
            messages,
            stream: true,
            max_tokens: input.maxTokens || 4096,
            ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
          }),
        })
      } catch (error) {
        throw new LlmProviderError(getErrorMessage(error), { cause: error })
      }

      if (!response.ok) {
        throw new LlmProviderError(`OpenAI-compatible request failed with HTTP ${response.status}`)
      }
      if (!response.body) {
        throw new LlmProviderError('OpenAI-compatible response did not include a stream body')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ''

        for (const line of lines) {
          const parsed = parseOpenAICompatibleSseLine(line)
          if (parsed.type === 'ignore') continue
          if (parsed.type === 'done') {
            yield { type: 'done' }
            return
          }
          yield parsed
        }
      }

      buffer += decoder.decode()
      if (buffer.trim()) {
        const parsed = parseOpenAICompatibleSseLine(buffer)
        if (parsed.type === 'done') {
          yield { type: 'done' }
          return
        }
        if (parsed.type !== 'ignore') yield parsed
      }
    },
  }
}
