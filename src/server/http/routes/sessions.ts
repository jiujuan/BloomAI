import { Hono } from 'hono'
import { sessionService } from '../../services/session.service'
import { ServiceError } from '../../services/errors'
import { readJson, readIntQuery } from '../util'

export const sessionsRoutes = new Hono()

sessionsRoutes.get('/', (c) => {
  const scope = c.req.query('scope')
  if (scope === undefined) return c.json({ data: sessionService.list() })
  if (scope !== 'recent') throw new ServiceError('VALIDATION_ERROR', 'scope must be recent')
  const parse = (key: string, fallback: number) => {
    const value = c.req.query(key)
    if (value === undefined) return fallback
    if (!/^(0|[1-9]\d*)$/.test(value)) throw new ServiceError('VALIDATION_ERROR', `${key} must be a non-negative integer`)
    return Number(value)
  }
  return c.json(sessionService.listRecent({ limit: parse('limit', 15), offset: parse('offset', 0) }))
})

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