import { Hono } from 'hono'
import { mapErrorToHttpResponse } from '../error-mapper'
import { skillService } from '../../services/skill.service'
import { readJson, readIntQuery } from '../util'

export const skillsRoutes = new Hono()

skillsRoutes.get('/', (c) => {
  try { return c.json({ data: skillService.listInstalled() }) } catch (error) { return errorResponse(c, error) }
})

skillsRoutes.get('/market', (c) => {
  try {
    const limit = readIntQuery(c, 'limit', 20)
    const data = skillService.listMarket({ query: c.req.query('q') || undefined, limit, offset: readIntQuery(c, 'offset', 0) })
    return c.json({ data, meta: { limit } })
  } catch (error) { return errorResponse(c, error) }
})

skillsRoutes.post('/install', async (c) => {
  try {
    const { id } = await readJson<any>(c)
    return c.json({ data: skillService.install(id) })
  } catch (error) { return errorResponse(c, error) }
})

skillsRoutes.post('/', async (c) => {
  try {
    return c.json({ data: skillService.create(await readJson<any>(c)) }, 201)
  } catch (error) { return errorResponse(c, error) }
})

skillsRoutes.get('/:id', (c) => {
  try { return c.json({ data: skillService.get(c.req.param('id')) }) } catch (error) { return errorResponse(c, error) }
})

skillsRoutes.patch('/:id', async (c) => {
  try { return c.json({ data: skillService.update(c.req.param('id'), await readJson<any>(c)) }) } catch (error) { return errorResponse(c, error) }
})

skillsRoutes.delete('/:id', (c) => {
  try {
    const result = skillService.remove(c.req.param('id'))
    if (result.kind === 'uninstalled') return c.json({ data: { uninstalled: true } })
    return c.body(null, 204)
  } catch (error) { return errorResponse(c, error) }
})

skillsRoutes.post('/:id/run', async (c) => {
  try {
    const body = await readJson<any>(c)
    return c.json({ data: await skillService.run(c.req.param('id'), body.input) })
  } catch (error) { return errorResponse(c, error) }
})

skillsRoutes.get('/:id/runs', (c) => {
  try { return c.json({ data: skillService.listRuns(c.req.param('id'), readIntQuery(c, 'limit', 20)) }) } catch (error) { return errorResponse(c, error) }
})

function errorResponse(c: any, error: unknown) {
  const response = mapErrorToHttpResponse(error)
  return c.json(response.body, response.status)
}