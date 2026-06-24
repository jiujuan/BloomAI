import { messageRepo } from '../db/repositories/message.repo'
import { personaRepo } from '../db/repositories/persona.repo'
import { sessionRepo } from '../db/repositories/session.repo'
import type { BuildChatContextInput, ChatPromptContext, ChatPromptDeps, ChatPromptMessage } from './types'

export const DEFAULT_CHAT_SYSTEM_PROMPT = 'You are BloomAI, a helpful AI assistant. Be concise, accurate, and friendly.'

const defaultDeps: ChatPromptDeps = {
  sessions: sessionRepo,
  personas: personaRepo,
  messages: messageRepo,
}

function toChatPromptMessage(message: { role: string; content: string }): ChatPromptMessage {
  return {
    role: message.role as ChatPromptMessage['role'],
    content: message.content,
  }
}

export function buildChatContext(input: BuildChatContextInput): ChatPromptContext | null {
  const deps = input.deps || defaultDeps
  const session = deps.sessions.get(input.sessionId)
  if (!session) return null

  const persona = session.persona_id ? deps.personas.get(session.persona_id) || null : null
  const history = deps.messages.getHistory(input.sessionId, input.historyLimit || 20).map(toChatPromptMessage)
  const baseSystemPrompt = persona?.system_prompt || DEFAULT_CHAT_SYSTEM_PROMPT

  return {
    session,
    persona,
    history,
    userContent: input.userContent,
    contextOverride: input.contextOverride,
    baseSystemPrompt,
  }
}
