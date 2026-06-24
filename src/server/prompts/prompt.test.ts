import { describe, expect, it, vi } from 'vitest'
import type { Persona } from '../db/repositories/persona.repo'
import type { Session } from '../db/repositories/session.repo'
import { DEFAULT_CHAT_SYSTEM_PROMPT, buildChatContext, organizeChatPrompt } from './index'
import type { ChatPromptContext } from './types'

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    title: 'New Chat',
    persona_id: null,
    model: 'gpt-4o',
    status: 'active',
    created_at: 1,
    updated_at: 1,
    ...overrides,
  }
}

function persona(overrides: Partial<Persona> = {}): Persona {
  return {
    id: 'persona-1',
    name: 'Helpful',
    system_prompt: 'Persona prompt',
    model_override: null,
    is_builtin: 0,
    created_at: 1,
    ...overrides,
  }
}

describe('chat prompt context', () => {
  it('builds context from session, persona, history, and runtime overrides', () => {
    const currentSession = session({ persona_id: 'persona-1' })
    const currentPersona = persona()
    const history = [{ role: 'assistant', content: 'Earlier answer' }]
    const deps = {
      sessions: { get: vi.fn(() => currentSession) },
      personas: { get: vi.fn(() => currentPersona) },
      messages: { getHistory: vi.fn(() => history) },
    }

    const context = buildChatContext({
      sessionId: 'session-1',
      userContent: 'Hi there',
      contextOverride: { activeApp: 'Editor' },
      deps,
    })

    expect(context).toEqual({
      session: currentSession,
      persona: currentPersona,
      history,
      userContent: 'Hi there',
      contextOverride: { activeApp: 'Editor' },
      baseSystemPrompt: 'Persona prompt',
    })
    expect(deps.messages.getHistory).toHaveBeenCalledWith('session-1', 20)
  })

  it('uses the default system prompt when the session has no persona', () => {
    const currentSession = session()
    const deps = {
      sessions: { get: vi.fn(() => currentSession) },
      personas: { get: vi.fn() },
      messages: { getHistory: vi.fn(() => []) },
    }

    const context = buildChatContext({
      sessionId: 'session-1',
      userContent: 'Hi there',
      deps,
    })

    expect(context?.persona).toBeNull()
    expect(context?.baseSystemPrompt).toBe(DEFAULT_CHAT_SYSTEM_PROMPT)
    expect(deps.personas.get).not.toHaveBeenCalled()
  })
})

describe('chat prompt organizer', () => {
  it('turns structured context into the final LLM prompt request', () => {
    const clipboardContent = 'x'.repeat(900)
    const context: ChatPromptContext = {
      session: session(),
      persona: null,
      history: [
        { role: 'user', content: 'Earlier question' },
        { role: 'assistant', content: 'Earlier answer' },
      ],
      userContent: 'Current question',
      contextOverride: {
        activeApp: 'Editor',
        clipboardContent,
      },
      baseSystemPrompt: 'Base prompt',
    }

    const prompt = organizeChatPrompt(context, { maxTokens: 2048 })

    expect(prompt).toEqual({
      system: `Base prompt\n\n---\nActive app: Editor\nClipboard:\n${'x'.repeat(800)}`,
      messages: [
        { role: 'user', content: 'Earlier question' },
        { role: 'assistant', content: 'Earlier answer' },
        { role: 'user', content: 'Current question' },
      ],
      maxTokens: 2048,
    })
  })
})
