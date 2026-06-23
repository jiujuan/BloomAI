import Anthropic from '@anthropic-ai/sdk'
import { LlmProviderError } from '../errors'
import { getProviderApiKey } from '../settings'
import type { ChatProvider, ChatStreamEvent, LlmMessage, ResolvedLlmModel } from '../types'

type QueueItem =
  | { kind: 'event'; event: ChatStreamEvent }
  | { kind: 'error'; error: unknown }
  | { kind: 'end' }

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Anthropic request failed'
}

function isAnthropicMessage(message: LlmMessage): message is LlmMessage & { role: 'user' | 'assistant' } {
  return message.role === 'user' || message.role === 'assistant'
}

export function createAnthropicProvider(resolved: ResolvedLlmModel): ChatProvider {
  return {
    async *streamChat(input) {
      const apiKey = getProviderApiKey(resolved.provider)
      const client = new Anthropic({ apiKey })
      const queue: QueueItem[] = []
      let notify: (() => void) | undefined
      let usageEmitted = false

      const push = (item: QueueItem) => {
        queue.push(item)
        notify?.()
        notify = undefined
      }
      const nextItem = async (): Promise<QueueItem> => {
        while (queue.length === 0) {
          await new Promise<void>((resolve) => {
            notify = resolve
          })
        }
        return queue.shift()!
      }

      const stream = client.messages.stream({
        model: resolved.model.modelId,
        system: input.system,
        messages: input.messages
          .filter(isAnthropicMessage)
          .map((message) => ({ role: message.role, content: message.content })),
        max_tokens: input.maxTokens || 4096,
      })

      stream.on('text', (text) => {
        push({ kind: 'event', event: { type: 'delta', text } })
      })
      stream.on('message', (message) => {
        const inputTokens = message?.usage?.input_tokens
        const outputTokens = message?.usage?.output_tokens
        if (typeof inputTokens === 'number' && typeof outputTokens === 'number') {
          usageEmitted = true
          push({ kind: 'event', event: { type: 'usage', input: inputTokens, output: outputTokens } })
        }
      })

      void stream.finalMessage()
        .then((message) => {
          const inputTokens = message?.usage?.input_tokens
          const outputTokens = message?.usage?.output_tokens
          if (!usageEmitted && typeof inputTokens === 'number' && typeof outputTokens === 'number') {
            push({ kind: 'event', event: { type: 'usage', input: inputTokens, output: outputTokens } })
          }
          push({ kind: 'event', event: { type: 'done' } })
          push({ kind: 'end' })
        })
        .catch((error) => {
          push({
            kind: 'error',
            error: new LlmProviderError(getErrorMessage(error), { cause: error }),
          })
        })

      while (true) {
        const item = await nextItem()
        if (item.kind === 'event') yield item.event
        if (item.kind === 'error') throw item.error
        if (item.kind === 'end') return
      }
    },
  }
}
