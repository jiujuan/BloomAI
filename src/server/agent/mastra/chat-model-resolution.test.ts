import { describe, expect, it } from 'vitest'
import type { Persona } from '../../db/repositories/persona.repo'
import { getPersonaModelOverride, getSessionModelOverride, resolveChatModel } from './chat-model-resolution'
import { resolveMastraModel } from './model-map'

describe('chat model resolution', () => {
  it('prefers persona override over session and settings models', () => {
    const persona = {
      is_builtin: 0,
      model_override: 'gpt-4o-mini',
    } as Persona

    expect(resolveChatModel(persona, 'claude-3-haiku-20240307', 'gpt-4o')).toBe('gpt-4o-mini')
  })

  it('uses the session model over the settings model', () => {
    expect(resolveChatModel(null, 'gpt-4o', 'claude-3-5-sonnet-20241022')).toBe('gpt-4o')
  })

  it('falls back to the settings model and then the legacy default', () => {
    expect(resolveChatModel(null, '', 'agnes-2.0-flash')).toBe('agnes-2.0-flash')
    expect(resolveChatModel(null, '', '')).toBe('claude-3-5-sonnet-20241022')
  })

  it('ignores legacy built-in persona model overrides', () => {
    const persona = {
      is_builtin: 1,
      model_override: 'claude-3-5-sonnet-20241022',
    } as Persona

    expect(getPersonaModelOverride(persona)).toBe('')
  })

  it('ignores the legacy fallback session model value', () => {
    expect(getSessionModelOverride('claude-3-5-sonnet-20241022')).toBe('')
  })

  it('returns unsupported for unmapped models', () => {
    expect(resolveMastraModel('unknown-model')).toEqual({
      ok: false,
      modelId: 'unknown-model',
      reason: 'Model unknown-model is not mapped for Mastra Agent v1',
    })
  })
})
