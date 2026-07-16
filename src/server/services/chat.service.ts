import { RequestContext } from '@mastra/core/request-context'
import { handleChatStream, toAISdkStream } from '@mastra/ai-sdk'
import { createUIMessageStream } from 'ai'
import { extractAttachmentText } from './attachment.service'
import { messageRepo } from '../db/repositories/message.repo'
import { sessionRepo } from '../db/repositories/session.repo'
import { logError, sanitizeErrorMessage } from '../logger/logger'
import { mastra } from '../mastra'
import { TEAM_AGENT_BY_TAB } from '../mastra/agents/team'
import { BLOOMAI_RESOURCE_ID } from '../mastra/memory'
import { normalizeWriting } from '../mastra/agents/writer-prompt'
import { streamOnError } from '../http/stream-error'
import type { WritingConfig } from '@shared/writing'
import { toClientAttachment, type Attachment } from '../../shared/attachments'

/** Default model preserved from the original chat HTTP route. */
export const DEFAULT_CHAT_MODEL = 'agnes-2.0-flash'
/** Maximum Mastra agent steps for a chat turn. */
export const MAX_STEPS = 10
/** Plan mode task-count hard cap. */
export const MAX_PLAN_TASKS = 10
/** Maximum total attachment text injected into one chat turn. */
export const ATTACHMENT_TOTAL_BUDGET = 24000

export type ChatRequestHeaders = {
  mode?: string
  model?: string
  sessionId?: string
  agentTab?: string
}

export type NormalizedChatInput = {
  body: Record<string, any>
  sessionId: string
  mode: string
  model: string
  teamAgentId?: string
  messages: any[]
  planTasks: string[]
  writing?: WritingConfig
  attachments: Attachment[]
}

export type PlanProposalInput = {
  sessionId: string
  model: string
  query?: unknown
  avoid?: unknown
}

export type PersistAssistantInput = {
  sessionId?: unknown
  content?: unknown
  parts?: unknown
  model?: unknown
  tokens?: unknown
  usage?: unknown
}

type PersistenceDependencies = {
  messageRepo: Pick<typeof messageRepo, 'count' | 'save'>
  sessionRepo: Pick<typeof sessionRepo, 'touch' | 'update'>
  extractAttachmentText: typeof extractAttachmentText
  logError: typeof logError
  sanitizeErrorMessage: typeof sanitizeErrorMessage
}

type RuntimeDependencies = {
  mastra: typeof mastra
  createRequestContext: () => RequestContext
  handleChatStream: typeof handleChatStream
  toAISdkStream: typeof toAISdkStream
  createUIMessageStream: typeof createUIMessageStream
  streamOnError: typeof streamOnError
}

export type ChatServiceDependencies = Partial<PersistenceDependencies & RuntimeDependencies>

/**
 * Convert the untrusted HTTP payload into the stable input consumed by chat use cases.
 * Header values intentionally retain their precedence over body values for compatibility.
 */
export function normalizeChatInput(input: {
  body: unknown
  headers: ChatRequestHeaders
}): NormalizedChatInput {
  const body = isRecord(input.body) ? input.body : {}
  const sessionCandidate = input.headers.sessionId || body.sessionId || body.id || ''
  const sessionId = typeof sessionCandidate === 'string' ? sessionCandidate.trim() : ''
  const mode = nonEmptyString(input.headers.mode) || 'chat'
  const model = nonEmptyString(input.headers.model) || DEFAULT_CHAT_MODEL
  const agentTab = nonEmptyString(input.headers.agentTab)

  return {
    body,
    sessionId,
    mode,
    model,
    teamAgentId: agentTab ? TEAM_AGENT_BY_TAB[agentTab] : undefined,
    messages: Array.isArray(body.messages) ? body.messages : [],
    planTasks: normalizeTasks(body.plan),
    writing: normalizeWriting(body.writing),
    attachments: normalizeAttachments(body.attachments),
  }
}

/** Normalize the non-streaming plan proposal request without accepting the chat body `id` alias. */
export function normalizePlanInput(input: { body: unknown, headers: Pick<ChatRequestHeaders, 'model' | 'sessionId'> }): PlanProposalInput {
  const body = isRecord(input.body) ? input.body : {}
  const sessionCandidate = input.headers.sessionId || body.sessionId || ''
  const sessionId = typeof sessionCandidate === 'string' ? sessionCandidate.trim() : ''
  return {
    sessionId,
    model: nonEmptyString(input.headers.model) || DEFAULT_CHAT_MODEL,
    query: body.query,
    avoid: body.avoid,
  }
}
/** Construct chat use cases with injectable infrastructure for focused service tests. */
export function createChatService(overrides: ChatServiceDependencies = {}) {
  const dependencies: PersistenceDependencies & RuntimeDependencies = {
    messageRepo,
    sessionRepo,
    extractAttachmentText,
    logError,
    sanitizeErrorMessage,
    mastra,
    createRequestContext: () => new RequestContext(),
    handleChatStream,
    toAISdkStream,
    createUIMessageStream,
    streamOnError,
    ...overrides,
  }

  function persistUserMessage(sessionId: string, messages: unknown, attachments: Attachment[] = []): void {
    if (!sessionId) return
    const text = lastUserText(messages)
    if (!text && attachments.length === 0) return

    const parts = attachments.length
      ? JSON.stringify([
          { type: 'text', text },
          { type: 'data-attachments', data: { files: attachments.map(toClientAttachment) } },
        ])
      : null

    try {
      const isFirst = dependencies.messageRepo.count(sessionId) === 0
      dependencies.messageRepo.save({ session_id: sessionId, role: 'user', content: text, parts })
      dependencies.sessionRepo.touch(sessionId)
      if (isFirst) {
        const title = (text || attachments[0]?.name || 'New Chat').slice(0, 60).trim()
        dependencies.sessionRepo.update(sessionId, { title })
      }
    } catch (error) {
      dependencies.logError(
        'chat.persistUser',
        { code: 'PERSISTENCE_ERROR', message: dependencies.sanitizeErrorMessage(error, 'persist user failed') },
        { sessionId },
      )
    }
  }

  async function buildAttachmentBlock(attachments: Attachment[]): Promise<string> {
    const blocks: string[] = []
    let used = 0
    for (const attachment of attachments) {
      if (used >= ATTACHMENT_TOTAL_BUDGET) {
        blocks.push(`【附件：${attachment.name}】（超出上下文预算，未展开；可用 doc_${attachment.ext} 工具按路径读取）`)
        continue
      }
      let text: string
      try {
        text = await dependencies.extractAttachmentText(attachment)
      } catch {
        text = `【附件：${attachment.name}】（文本提取失败，未展开；可用 doc_${attachment.ext} 工具按路径读取）`
      }
      const remaining = ATTACHMENT_TOTAL_BUDGET - used
      const clipped = text.length > remaining ? `${text.slice(0, remaining)}\n…（截断）` : text
      used += clipped.length
      blocks.push(`【附件：${attachment.name}】\n${clipped}`)
    }
    return ['以下是用户上传的附件内容，请结合它们回答用户的问题：', ...blocks].join('\n\n')
  }

  async function proposePlan(input: PlanProposalInput): Promise<{ tasks: string[] }> {
    const query = typeof input.query === 'string' ? input.query.trim() : ''
    if (!query) return { tasks: [] }
    const avoid = Array.isArray(input.avoid)
      ? input.avoid.filter((task): task is string => typeof task === 'string' && !!task.trim())
      : []

    const requestContext = dependencies.createRequestContext()
    requestContext.set('model', input.model)
    requestContext.set('sessionId', input.sessionId)
    const prompt = [
      `User request: ${query}`,
      avoid.length ? `\nPropose a DIFFERENT plan; avoid repeating these tasks:\n- ${avoid.join('\n- ')}` : '',
      `\nReturn a JSON array of 3-5 concrete tasks (at most ${MAX_PLAN_TASKS}).`,
    ].join('')

    let tasks: string[] = []
    try {
      const planner = dependencies.mastra.getAgent('plan-planner')
      const response = await (planner as any).generate(prompt, {
        requestContext,
        memory: { thread: input.sessionId, resource: BLOOMAI_RESOURCE_ID },
      })
      tasks = parsePlanTasks(response.text)
    } catch (error) {
      dependencies.logError(
        'chat.proposePlan',
        { code: 'PLAN_ERROR', message: dependencies.sanitizeErrorMessage(error, 'propose plan failed') },
        { sessionId: input.sessionId },
      )
    }
    return { tasks: tasks.length ? tasks : [query] }
  }

  function persistAssistantMessage(input: PersistAssistantInput): { kind: 'session-required' | 'empty' | 'saved' | 'failed' } {
    const sessionId = String(input?.sessionId || '')
    if (!sessionId) return { kind: 'session-required' }

    const content = typeof input?.content === 'string' ? input.content : ''
    const parts = Array.isArray(input?.parts) ? input.parts : null
    if (!content && !parts) return { kind: 'empty' }

    try {
      dependencies.messageRepo.save({
        session_id: sessionId,
        role: 'assistant',
        content,
        parts: parts ? JSON.stringify(parts) : null,
        tool_calls: JSON.stringify({ runtime: 'mastra-chat-agent-v1', model: String(input?.model || '') }),
        tokens: typeof input?.tokens === 'number' ? input.tokens : tokenCount(input?.usage),
      })
      dependencies.sessionRepo.touch(sessionId)
      return { kind: 'saved' }
    } catch (error) {
      dependencies.logError(
        'chat.persistAssistant',
        { code: 'PERSISTENCE_ERROR', message: dependencies.sanitizeErrorMessage(error, 'persist assistant failed') },
        { sessionId },
      )
      return { kind: 'failed' }
    }
  }

  async function streamChat(input: NormalizedChatInput, abortSignal?: AbortSignal): Promise<any> {
    const requestContext = dependencies.createRequestContext()
    requestContext.set('mode', input.mode)
    requestContext.set('model', input.model)
    requestContext.set('sessionId', input.sessionId)
    if (input.planTasks.length) requestContext.set('planTasks', input.planTasks)
    if (input.writing) requestContext.set('writing', input.writing)

    // User persistence is deliberately best-effort and always happens before runtime work.
    persistUserMessage(input.sessionId, input.messages, input.attachments)

    try {
      // A selected specialist always wins over deep mode, preserving the original route behavior.
      if (!input.teamAgentId && input.mode === 'deep') {
        const query = lastUserText(input.messages)
        if (query) {
          const run = await (dependencies.mastra.getWorkflow('deep-research') as any).createRun()
          const workflowStream = await run.stream({ inputData: { query }, requestContext })
          return dependencies.createUIMessageStream({
            execute: async ({ writer }: any) => {
              for await (const part of dependencies.toAISdkStream(workflowStream as any, { from: 'workflow' }) as any) {
                await writer.write(part)
              }
            },
            onError: dependencies.streamOnError('chat.deep', { sessionId: input.sessionId }),
          } as any)
        }
      }

      const attachmentBlock = input.attachments.length ? await buildAttachmentBlock(input.attachments) : ''
      const useMemory = !input.teamAgentId
      let agentMessages: any[]
      if (useMemory) {
        const latestMessage = input.messages.at?.(-1)
        const latestOnly = latestMessage ? [latestMessage] : []
        const withPlan = input.planTasks.length ? augmentLastUserMessage(latestOnly, input.planTasks) : latestOnly
        agentMessages = attachmentBlock ? appendToLastUserMessage(withPlan, attachmentBlock) : withPlan
      } else {
        const withPlan = input.planTasks.length ? augmentLastUserMessage(input.messages, input.planTasks) : input.messages
        agentMessages = attachmentBlock ? appendToLastUserMessage(withPlan, attachmentBlock) : withPlan
      }

      const stream = await dependencies.handleChatStream({
        mastra: dependencies.mastra,
        agentId: input.teamAgentId || 'chat',
        version: 'v6',
        sendReasoning: true,
        onError: dependencies.streamOnError('chat.stream', { sessionId: input.sessionId, agentId: input.teamAgentId || 'chat' }),
        params: {
          ...input.body,
          messages: agentMessages,
          ...(useMemory ? { memory: { threadId: input.sessionId, resourceId: BLOOMAI_RESOURCE_ID } } : {}),
          requestContext,
          abortSignal,
          maxSteps: MAX_STEPS,
        } as any,
      } as any)

      if (!input.planTasks.length) return stream
      return dependencies.createUIMessageStream({
        execute: async ({ writer }: any) => {
          let injected = false
          for await (const chunk of stream as any) {
            await writer.write(chunk)
            if (!injected && (chunk?.type === 'start' || chunk?.type === 'start-step')) {
              await writer.write({ type: 'data-plan', data: { tasks: input.planTasks } })
              injected = true
            }
          }
          if (!injected) await writer.write({ type: 'data-plan', data: { tasks: input.planTasks } })
        },
        onError: dependencies.streamOnError('chat.plan-exec', { sessionId: input.sessionId }),
      } as any)
    } catch (error) {
      // Preserve the existing error-only UI stream rather than turning pre-stream failures into HTTP errors.
      return dependencies.createUIMessageStream({
        execute: async () => { throw error },
        onError: dependencies.streamOnError('chat.route', { sessionId: input.sessionId, mode: input.mode }),
      } as any)
    }
  }
  return { persistUserMessage, buildAttachmentBlock, proposePlan, persistAssistantMessage, streamChat }
}

export const chatService = createChatService()

export function normalizeTasks(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const tasks: string[] = []
  for (const item of value) {
    const task = typeof item === 'string' ? item.trim() : ''
    if (!task || seen.has(task)) continue
    seen.add(task)
    tasks.push(task)
    if (tasks.length >= MAX_PLAN_TASKS) break
  }
  return tasks
}

export function parsePlanTasks(text: string): string[] {
  try {
    const match = text.match(/\[[\s\S]*\]/)
    return normalizeTasks(JSON.parse(match ? match[0] : text))
  } catch {
    return []
  }
}

/** Keep only stored attachment records that can be safely read server-side. */
export function normalizeAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (attachment): attachment is Attachment =>
      !!attachment
      && typeof attachment.name === 'string'
      && typeof attachment.ext === 'string'
      && typeof attachment.path === 'string',
  )
}

export function lastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return ''
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role !== 'user') continue
    if (typeof message.content === 'string') return message.content
    if (Array.isArray(message.parts)) {
      return message.parts.filter((part: any) => part?.type === 'text').map((part: any) => part.text).join('').trim()
    }
  }
  return ''
}

/** Rewrites the final user message on a copy so a confirmed plan reaches the model prompt. */
export function augmentLastUserMessage(messages: any, planTasks: string[]): any {
  if (!Array.isArray(messages)) return messages
  let index = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') { index = i; break }
  }
  if (index < 0) return messages
  const original = lastUserText([messages[index]])
  const list = planTasks.map((task, taskIndex) => `${taskIndex + 1}. ${task}`).join('\n')
  const wrapped = [
    'Follow the confirmed plan below strictly. Complete every task and organize the final answer by task number.',
    '',
    `我的原始请求：${original}`,
    '',
    '已确认的计划：',
    list,
  ].join('\n')
  const copy = messages.slice()
  copy[index] = { ...messages[index], parts: [{ type: 'text', text: wrapped }], content: wrapped }
  return copy
}

/** Append service-generated context to the final user message without mutating the input array. */
export function appendToLastUserMessage(messages: any, extra: string): any {
  if (!Array.isArray(messages) || !extra) return messages
  let index = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') { index = i; break }
  }
  if (index < 0) return messages
  const base = lastUserText([messages[index]])
  const combined = base ? `${base}\n\n${extra}` : extra
  const copy = messages.slice()
  copy[index] = { ...messages[index], parts: [{ type: 'text', text: combined }], content: combined }
  return copy
}
function tokenCount(usage: any): number | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  if (typeof usage.totalTokens === 'number') return usage.totalTokens
  const input = typeof usage.inputTokens === 'number' ? usage.inputTokens : 0
  const output = typeof usage.outputTokens === 'number' ? usage.outputTokens : 0
  return input || output ? input + output : undefined
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}



