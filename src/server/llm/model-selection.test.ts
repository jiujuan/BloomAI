import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Persona } from '../db/repositories/persona.repo'

let dataDir: string

async function loadModelSelection() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../db/client')
  await client.runMigrations()
  const modelSelection = await import('./model-selection')
  const { llmRepo } = await import('../db/repositories/llm.repo')
  const { settingsRepo } = await import('../db/repositories/settings.repo')
  const errors = await import('./errors')

  return { ...modelSelection, llmRepo, settingsRepo, ...errors }
}

describe('runtime model selection', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-model-selection-'))
  })

  afterEach(() => {
    vi.resetModules()
    delete process.env.DATA_DIR
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('prefers an explicit requested model before persona, session, and settings models', async () => {
    const { resolveRuntimeModel, settingsRepo } = await loadModelSelection()
    settingsRepo.setMany({ model: 'claude-3-5-sonnet-20241022' })

    const resolved = await resolveRuntimeModel({
      consumer: 'chat',
      modality: 'text',
      requestedModel: 'gpt-4o-mini',
      persona: createPersona('deepseek-chat'),
      sessionModel: 'gpt-4o',
    })

    expect(resolved).toMatchObject({
      selectedModelId: 'gpt-4o-mini',
      source: 'requested',
      resolved: {
        provider: { id: 'openai' },
        model: { id: 'gpt-4o-mini', modelId: 'gpt-4o-mini' },
      },
    })
  })

  it('prefers persona override before the session model', async () => {
    const { resolveRuntimeModel } = await loadModelSelection()

    const resolved = await resolveRuntimeModel({
      consumer: 'agent',
      modality: 'text',
      persona: createPersona('gpt-4o-mini'),
      sessionModel: 'gpt-4o',
    })

    expect(resolved.selectedModelId).toBe('gpt-4o-mini')
    expect(resolved.source).toBe('persona')
  })

  it('uses session model before settings model', async () => {
    const { resolveRuntimeModel, settingsRepo } = await loadModelSelection()
    settingsRepo.setMany({ model: 'claude-3-5-sonnet-20241022' })

    const resolved = await resolveRuntimeModel({
      consumer: 'chat',
      modality: 'text',
      sessionModel: 'gpt-4o',
    })

    expect(resolved.selectedModelId).toBe('gpt-4o')
    expect(resolved.source).toBe('session')
  })

  it('uses settings model when session model is empty or legacy fallback', async () => {
    const { resolveRuntimeModel, settingsRepo } = await loadModelSelection()
    settingsRepo.setMany({ model: 'agnes-2.0-flash' })

    await expect(resolveRuntimeModel({
      consumer: 'chat',
      modality: 'text',
      sessionModel: '',
    })).resolves.toMatchObject({
      selectedModelId: 'agnes-2.0-flash',
      source: 'settings',
    })

    await expect(resolveRuntimeModel({
      consumer: 'agent',
      modality: 'text',
      sessionModel: 'claude-3-5-sonnet-20241022',
    })).resolves.toMatchObject({
      selectedModelId: 'agnes-2.0-flash',
      source: 'settings',
    })
  })

  it('ignores legacy built-in persona model overrides', async () => {
    const { resolveRuntimeModel, settingsRepo } = await loadModelSelection()
    settingsRepo.setMany({ model: 'gpt-4o' })

    const resolved = await resolveRuntimeModel({
      consumer: 'chat',
      modality: 'text',
      persona: createPersona('claude-3-5-sonnet-20241022', { isBuiltin: true }),
      sessionModel: 'claude-3-5-sonnet-20241022',
    })

    expect(resolved.selectedModelId).toBe('gpt-4o')
    expect(resolved.source).toBe('settings')
  })

  it('falls back to the legacy chat model when no other model is available', async () => {
    const { resolveRuntimeModel, settingsRepo } = await loadModelSelection()
    settingsRepo.setMany({ model: '' })

    const resolved = await resolveRuntimeModel({
      consumer: 'chat',
      modality: 'text',
    })

    expect(resolved.selectedModelId).toBe('claude-3-5-sonnet-20241022')
    expect(resolved.source).toBe('fallback')
  })

  it('formats resolved models for Mastra without a separate adapter', async () => {
    const { toMastraModelId } = await loadModelSelection()

    expect(toMastraModelId(createResolved('openai', 'gpt-4o'))).toBe('openai/gpt-4o')
    expect(toMastraModelId(createResolved('deepseek', 'deepseek-chat'))).toBe('deepseek/deepseek-chat')
    expect(toMastraModelId(createResolved('ollama', 'llama3.1:latest'))).toBe('ollama/llama3.1:latest')
    expect(toMastraModelId(createResolved('openai', 'openai/gpt-4o'))).toBe('openai/gpt-4o')
  })
  it('uses registry validation for unsupported or disabled models', async () => {
    const { LlmConfigError, LlmUnsupportedModelError, llmRepo, resolveRuntimeModel } = await loadModelSelection()

    await expect(resolveRuntimeModel({
      consumer: 'agent',
      modality: 'text',
      requestedModel: 'unknown-model',
    })).rejects.toBeInstanceOf(LlmUnsupportedModelError)

    llmRepo.updateModel('gpt-4o', { isEnabled: false })
    await expect(resolveRuntimeModel({
      consumer: 'chat',
      modality: 'text',
      requestedModel: 'gpt-4o',
    })).rejects.toBeInstanceOf(LlmConfigError)
  })
})

function createPersona(modelOverride: string, options: { isBuiltin?: boolean } = {}): Persona {
  return {
    id: 'persona-1',
    name: 'Persona',
    system_prompt: 'Prompt',
    model_override: modelOverride,
    is_builtin: options.isBuiltin ? 1 : 0,
    created_at: Date.now(),
  }
}

function createResolved(providerId: string, modelId: string) {
  return {
    provider: {
      id: providerId,
      name: providerId,
      kind: providerId === 'ollama' ? 'ollama' as const : 'openai-compatible' as const,
      baseUrl: null,
      apiKeySettingKey: null,
      isEnabled: true,
      config: {},
    },
    model: {
      id: modelId,
      providerId,
      modelId,
      label: modelId,
      modality: 'text' as const,
      capabilities: {},
      isEnabled: true,
      isBuiltin: true,
      sortOrder: 0,
    },
  }
}