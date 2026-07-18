import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dataDir = ''
let originalEnv: NodeJS.ProcessEnv

async function loadContext() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../../db/client')
  await client.runMigrations()
  const { settingsRepo } = await import('../../db/repositories/settings.repo')
  const { llmRepo } = await import('../../db/repositories/llm.repo')
  const modelSelection = await import('./model-selection')
  const { ResearchDomainError } = await import('./errors')
  return { client, settingsRepo, llmRepo, ...modelSelection, ResearchDomainError }
}

describe('Deep Research model selection', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-research-model-selection-'))
    originalEnv = { ...process.env }
  })

  afterEach(async () => {
    const client = await import('../../db/client')
    client.closeDb()
    vi.resetModules()
    process.env = originalEnv
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('prefers the requested model, then the dedicated setting, then the general text setting and snapshots no secret', async () => {
    const { settingsRepo, resolveResearchRuntimeModel } = await loadContext()
    settingsRepo.setMany({
      model: 'gpt-4o',
      deep_research_model: 'deepseek-chat',
      openai_api_key: 'openai-test-secret',
      deepseek_api_key: 'deepseek-test-secret',
    })

    await expect(resolveResearchRuntimeModel({ requestedModelId: 'gpt-4o' })).resolves.toMatchObject({
      snapshot: {
        requestedModelId: 'gpt-4o',
        selectedModelId: 'gpt-4o',
        providerId: 'openai',
        providerKind: 'openai',
        selectionSource: 'requested',
        settingsKey: 'model',
        modelContractVersion: 'research-model-selection/v1',
      },
    })

    const dedicated = await resolveResearchRuntimeModel()
    expect(dedicated.snapshot).toMatchObject({
      requestedModelId: null,
      selectedModelId: 'deepseek-chat',
      providerId: 'deepseek',
      selectionSource: 'deep_research_setting',
      settingsKey: 'deep_research_model',
    })
    expect(JSON.stringify(dedicated.snapshot)).not.toContain('deepseek-test-secret')

    settingsRepo.setMany({ deep_research_model: '' })
    await expect(resolveResearchRuntimeModel()).resolves.toMatchObject({
      snapshot: {
        selectedModelId: 'gpt-4o',
        selectionSource: 'general_setting',
        settingsKey: 'model',
      },
    })
  })

  it('returns an actionable domain error instead of a deterministic fallback when no usable model is configured', async () => {
    const { settingsRepo, llmRepo, resolveResearchRuntimeModel, ResearchDomainError } = await loadContext()
    settingsRepo.setMany({ model: '', deep_research_model: '' })

    await expect(resolveResearchRuntimeModel()).rejects.toMatchObject({
      code: 'RESEARCH_MODEL_UNAVAILABLE',
      retryable: false,
      details: { action: 'configure_model' },
    } satisfies Partial<InstanceType<typeof ResearchDomainError>>)

    settingsRepo.setMany({ deep_research_model: 'gpt-4o', openai_api_key: 'openai-test-secret' })
    llmRepo.updateModel('gpt-4o', { isEnabled: false })
    await expect(resolveResearchRuntimeModel()).rejects.toMatchObject({
      code: 'RESEARCH_MODEL_UNAVAILABLE',
      details: { action: 'enable_model' },
    })
  })

  it('resolves a resumed run only through its durable snapshot even when settings change', async () => {
    const { settingsRepo, resolveResearchRuntimeModel, resolveResearchModelSnapshot } = await loadContext()
    settingsRepo.setMany({
      model: 'gpt-4o',
      deep_research_model: 'deepseek-chat',
      openai_api_key: 'openai-test-secret',
      deepseek_api_key: 'deepseek-test-secret',
    })
    const initial = await resolveResearchRuntimeModel()

    settingsRepo.setMany({ deep_research_model: 'gpt-4o' })
    await expect(resolveResearchModelSnapshot(initial.snapshot)).resolves.toMatchObject({
      snapshot: expect.objectContaining({
        selectedModelId: 'deepseek-chat',
        providerId: 'deepseek',
      }),
    })
  })
})
