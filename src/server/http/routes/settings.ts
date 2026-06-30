import { Hono } from 'hono'
import { settingsRepo } from '../../db/repositories/settings.repo'
import { readJson } from '../util'

export const settingsRoutes = new Hono()

const MASKED_KEYS = ['anthropic_api_key', 'openai_api_key', 'agnes_api_key', 'deepseek_api_key'] as const

settingsRoutes.get('/', async (c) => {
  const settings = await settingsRepo.list()
  for (const key of MASKED_KEYS) {
    if (settings[key]) settings[key] = '***masked***'
  }
  return c.json({ data: settings })
})

settingsRoutes.patch('/', async (c) => {
  const updates = await readJson<Record<string, string>>(c)
  return c.json({ data: { updated: await settingsRepo.setMany(updates) } })
})

settingsRoutes.get('/:key', async (c) => {
  const value = await settingsRepo.getValue(c.req.param('key'))
  if (value === undefined) return c.json({ error: { code: 'NOT_FOUND', message: 'Setting not found' } }, 404)
  return c.json({ data: { key: c.req.param('key'), value } })
})
