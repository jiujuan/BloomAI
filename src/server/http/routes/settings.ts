import { Hono } from 'hono'
import { settingsService } from '../../services/settings.service'
import { readJson } from '../util'

export const settingsRoutes = new Hono()

settingsRoutes.get('/', (c) => c.json({ data: settingsService.listForClient() }))

settingsRoutes.patch('/', async (c) => {
  const updates = await readJson<Record<string, string>>(c)
  return c.json({ data: settingsService.update(updates) })
})

settingsRoutes.get('/:key', (c) => c.json({ data: settingsService.getForClient(c.req.param('key')) }))