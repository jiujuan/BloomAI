import { Hono } from 'hono'
import { llmService } from '../../services/llm.service'
import { isServiceError } from '../../services/errors'
import { readJson } from '../util'

export const llmRoutes = new Hono()

function legacyRuntimeError(error: unknown, fallbackCode: string, fallbackMessage: string) {
  const value = error as { code?: unknown; message?: unknown }
  return {
    code: typeof value?.code === 'string' ? value.code : fallbackCode,
    message: typeof value?.message === 'string' ? value.message : fallbackMessage,
  }
}

llmRoutes.get('/providers', (c) => c.json({ data: llmService.listProviders() }))

llmRoutes.post('/providers', async (c) => {
  const body = await readJson<any>(c)
  return c.json({ data: llmService.createProvider(body || {}) }, 201)
})

llmRoutes.patch('/providers/:id', async (c) => {
  return c.json({ data: llmService.updateProvider(c.req.param('id'), (await readJson<any>(c)) || {}) })
})

llmRoutes.get('/models', (c) => c.json({ data: llmService.listModels({ modality: c.req.query('modality') }) }))

llmRoutes.post('/models', async (c) => {
  return c.json({ data: llmService.createModel((await readJson<any>(c)) || {}) }, 201)
})

llmRoutes.patch('/models/:id', async (c) => {
  return c.json({ data: llmService.updateModel(c.req.param('id'), (await readJson<any>(c)) || {}) })
})

llmRoutes.post('/videos', async (c) => {
  try {
    return c.json({ data: await llmService.createVideoTask((await readJson<any>(c)) || {}) }, 201)
  } catch (error) {
    if (isServiceError(error)) throw error
    const { code, message } = legacyRuntimeError(error, 'LLM_PROVIDER_ERROR', 'Video task creation failed')
    return c.json({ error: { code, message } }, 500)
  }
})

llmRoutes.get('/videos/:id', async (c) => {
  try {
    return c.json({ data: await llmService.getVideoTask(c.req.param('id')) })
  } catch (error) {
    if (isServiceError(error)) throw error
    const { code, message } = legacyRuntimeError(error, 'LLM_PROVIDER_ERROR', 'Video task lookup failed')
    return c.json({ error: { code, message } }, code === 'LLM_UNSUPPORTED_MODEL' ? 404 : 500)
  }
})

llmRoutes.get('/ollama/models', async (c) => {
  try {
    return c.json({ data: await llmService.listRemoteOllamaModels() })
  } catch (error) {
    if (isServiceError(error)) throw error
    const { code, message } = legacyRuntimeError(error, 'LLM_PROVIDER_ERROR', 'Ollama discovery failed')
    return c.json({ error: { code, message } }, 500)
  }
})