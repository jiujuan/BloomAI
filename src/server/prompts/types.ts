import type { Persona } from '../db/repositories/persona.repo'
import type { Session } from '../db/repositories/session.repo'

export type ChatPromptRole = 'user' | 'assistant'

export type ChatPromptMessage = {
  role: ChatPromptRole
  content: string
}

export type ChatPromptContextOverride = {
  activeApp?: string
  clipboardContent?: string
}

export type ChatPromptDeps = {
  sessions: {
    get(id: string): Session | undefined
  }
  personas: {
    get(id: string): Persona | undefined
  }
  messages: {
    getHistory(sessionId: string, last?: number): Array<{ role: string; content: string }>
  }
}

export type BuildChatContextInput = {
  sessionId: string
  userContent: string
  contextOverride?: ChatPromptContextOverride
  historyLimit?: number
  deps?: ChatPromptDeps
}

export type ChatPromptContext = {
  session: Session
  persona: Persona | null
  history: ChatPromptMessage[]
  userContent: string
  contextOverride?: ChatPromptContextOverride
  baseSystemPrompt: string
}

export type OrganizedChatPrompt = {
  system: string
  messages: ChatPromptMessage[]
  maxTokens: number
}

export type OrganizeChatPromptOptions = {
  maxTokens?: number
}
