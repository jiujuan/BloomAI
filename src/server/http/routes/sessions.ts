import { Hono } from 'hono'
import { sessionService } from '../../services/session.service'
import { readJson, readIntQuery } from '../util'

export const sessionsRoutes = new Hono()

sessionsRoutes.get('/', (c) => c.json({ data: sessionService.list() }))

sessionsRoutes.post('/', async (c) => c.json({ data: sessionService.create((await readJson(c)) || {}) }, 201))

sessionsRoutes.get('/:id', (c) => c.json({ data: sessionService.get(c.req.param('id')) }))

sessionsRoutes.patch('/:id', async (c) => c.json({
  data: sessionService.update(c.req.param('id'), await readJson(c)),
}))

sessionsRoutes.delete('/:id', (c) => {
  sessionService.remove(c.req.param('id'))
  return c.body(null, 204)
})

sessionsRoutes.get('/:id/messages', (c) => {
  const limit = readIntQuery(c, 'limit', 100)
  const offset = readIntQuery(c, 'offset', 0)
  const page = sessionService.listMessages(c.req.param('id'), { limit, offset })
  return c.json(page)
})