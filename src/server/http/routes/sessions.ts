import { Hono } from 'hono'
import { sessionRepo } from '../../db/repositories/session.repo'
import { messageRepo } from '../../db/repositories/message.repo'
import { readJson, readIntQuery } from '../util'

export const sessionsRoutes = new Hono()

sessionsRoutes.get('/', (c) => c.json({ data: sessionRepo.list() }))

sessionsRoutes.post('/', async (c) => c.json({ data: sessionRepo.create((await readJson(c)) || {}) }, 201))

sessionsRoutes.get('/:id', (c) => {
  const session = sessionRepo.get(c.req.param('id'))
  if (!session) return c.json({ error: { code: 'NOT_FOUND', message: 'Session not found' } }, 404)
  return c.json({ data: session })
})

sessionsRoutes.patch('/:id', async (c) => {
  const session = sessionRepo.update(c.req.param('id'), await readJson(c))
  if (!session) return c.json({ error: { code: 'NOT_FOUND', message: 'Session not found' } }, 404)
  return c.json({ data: session })
})

sessionsRoutes.delete('/:id', (c) => {
  sessionRepo.delete(c.req.param('id'))
  return c.body(null, 204)
})

sessionsRoutes.get('/:id/messages', (c) => {
  const limit = readIntQuery(c, 'limit', 100)
  const offset = readIntQuery(c, 'offset', 0)
  const id = c.req.param('id')
  return c.json({ data: messageRepo.list(id, limit, offset), meta: { total: messageRepo.count(id), limit, offset } })
})
