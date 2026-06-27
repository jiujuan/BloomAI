import { DEFAULT_AGENT_MAX_STEPS, MASTRA_CHAT_AGENT_V1_RUNTIME } from './constants'
import { createChatAgent } from './chat-agent'
import { mapMastraChunkToBloomEvent, mapMastraFinalOutputToBloomEvents } from './mastra-event-mapper'
import { resolveChatCapabilities } from '../runtime/capabilities'
import { resolveChatIntent } from '../runtime/intent/chat-intent-router'
import { resolveRuntimeModel, toMastraModelId } from '../../llm/model-selection'
import { getProviderApiKey, getProviderBaseUrl } from '../../llm/settings'
import type { OpenAICompatibleConfig } from '@mastra/core/llm'
import type { ResolvedLlmModel } from '../../llm/types'
import type { OrganizedChatPrompt } from '../../prompts/types'
import type { LlmMessage } from '../../llm/types'
import type { ChatAgentRunInput, ChatAgentRuntimeEvent } from './types'

type StreamOutputLike = {
  fullStream: unknown
  toolCalls?: unknown
  toolResults?: unknown
  emittedDone?: boolean
}

export async function* runChatAgentV1(input: ChatAgentRunInput): AsyncGenerator<ChatAgentRuntimeEvent> {
  const modelResolution = await resolveAgentModel(input.model)
  if (!modelResolution.ok) {
    yield { type: 'error', error: modelResolution.error }
    return
  }

  const capabilities = resolveChatCapabilities()
  const intent = await resolveChatIntent({
    sessionId: input.sessionId,
    content: input.content,
    prompt: input.prompt,
    availableTools: capabilities.tools,
    availableSkills: capabilities.skills,
  })
  const agent = createChatAgent(toMastraModelConfig(modelResolution.resolved), {
    sessionId: input.sessionId,
    prompt: input.prompt,
    intent,
    enabledTools: capabilities.tools,
    enabledSkills: capabilities.skills,
    selectedTools: intent.selectedTools,
    selectedSkills: intent.selectedSkills,
  })
  const maxSteps = Math.min(input.maxSteps ?? DEFAULT_AGENT_MAX_STEPS, DEFAULT_AGENT_MAX_STEPS)
  const emittedCallIds = new Set<string>()
  const emittedResultIds = new Set<string>()
  let emittedDone = false

  const streamOutput = await maybeStreamAgent(agent, input, maxSteps)
  if (streamOutput) {
    for await (const chunk of getAsyncIterable(streamOutput.fullStream)) {
      const event = mapMastraChunkToBloomEvent(chunk, { maxSteps })
      if (!event) continue

      trackEmittedToolEvent(event, emittedCallIds, emittedResultIds)
      if (event.type === 'done') emittedDone = true
      yield event
    }

    for (const event of mapMastraFinalOutputToBloomEvents(streamOutput, { emittedCallIds, emittedResultIds })) {
      trackEmittedToolEvent(event, emittedCallIds, emittedResultIds)
      if (event.type === 'done') emittedDone = true
      yield event
    }

    if (!emittedDone) {
      yield createDoneEvent(maxSteps)
    }
    return
  }

  yield createDoneEvent(maxSteps)
}

function toMastraOpenAICompatibleModelId(resolved: ResolvedLlmModel): `${string}/${string}` {
  const modelId = toMastraModelId(resolved)
  if (!modelId.includes('/')) throw new Error(`Mastra model id must include provider and model: ${modelId}`)
  return modelId as `${string}/${string}`
}
function toMastraModelConfig(resolved: ResolvedLlmModel): string | OpenAICompatibleConfig {
  if (resolved.provider.kind === 'openai-compatible') {
    return {
      id: toMastraOpenAICompatibleModelId(resolved),
      url: getProviderBaseUrl(resolved.provider),
      apiKey: getProviderApiKey(resolved.provider),
    }
  }

  return toMastraModelId(resolved)
}
async function resolveAgentModel(model: string): Promise<{ ok: true; resolved: Awaited<ReturnType<typeof resolveRuntimeModel>>['resolved'] } | { ok: false; error: string }> {
  try {
    const modelResolution = await resolveRuntimeModel({
      consumer: 'agent',
      modality: 'text',
      requestedModel: model,
    })
    return { ok: true, resolved: modelResolution.resolved }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Agent model resolution failed' }
  }
}
async function maybeStreamAgent(agent: unknown, input: ChatAgentRunInput, maxSteps: number): Promise<StreamOutputLike | null> {
  if (!hasStreamMethod(agent)) return null
  const output = await agent.stream(createAgentPromptInput(input.prompt, input.content), { maxSteps })
  return isStreamOutputLike(output) ? output : null
}

export function createAgentPromptInput(prompt: OrganizedChatPrompt, content: string): LlmMessage[] {
  const messages: LlmMessage[] = []
  if (prompt.system.trim()) {
    messages.push({ role: 'system', content: prompt.system })
  }

  const promptMessages = prompt.messages.length > 0
    ? prompt.messages
    : [{ role: 'user' as const, content }]

  for (const message of promptMessages) {
    messages.push({ role: message.role, content: message.content })
  }

  return messages
}

function hasStreamMethod(agent: unknown): agent is { stream: (messages: LlmMessage[], options: { maxSteps: number }) => Promise<unknown> } {
  return !!agent && typeof agent === 'object' && typeof (agent as { stream?: unknown }).stream === 'function'
}

function isStreamOutputLike(output: unknown): output is StreamOutputLike {
  return !!output && typeof output === 'object' && 'fullStream' in output
}

function getAsyncIterable(stream: unknown): AsyncIterable<unknown> {
  if (isAsyncIterable(stream)) return stream
  if (isReadableStream(stream)) return stream as ReadableStream<unknown>
  return emptyAsyncIterable()
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return !!value && typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
}

function isReadableStream(value: unknown): value is ReadableStream<unknown> {
  return !!value && typeof value === 'object' && typeof (value as { getReader?: unknown }).getReader === 'function'
}

async function* emptyAsyncIterable(): AsyncIterable<unknown> {}

function trackEmittedToolEvent(
  event: ChatAgentRuntimeEvent,
  emittedCallIds: Set<string>,
  emittedResultIds: Set<string>,
): void {
  if (event.type === 'tool_call_start') emittedCallIds.add(event.call.callId)
  if (event.type === 'tool_call_result' || event.type === 'tool_call_error') emittedResultIds.add(event.callId)
}


function createDoneEvent(maxSteps: number): ChatAgentRuntimeEvent {
  return {
    type: 'done',
    trace: {
      runtime: MASTRA_CHAT_AGENT_V1_RUNTIME,
      maxSteps,
      toolCalls: [],
    },
  }
}
