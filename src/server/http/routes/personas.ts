import { Hono } from 'hono'
import { personaService } from '../../services/persona.service'
import { readJson } from '../util'

export const personasRoutes = new Hono()

personasRoutes.get('/', (c) => c.json({ data: personaService.list() }))

personasRoutes.post('/', async (c) => {
  const { name, system_prompt, model_override } = await readJson<any>(c)
  if (!name || !system_prompt) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'name and system_prompt are required' } }, 400)
  }
  return c.json({ data: personaService.create({ name, system_prompt, model_override }) }, 201)
})

personasRoutes.get('/:id', (c) => c.json({ data: personaService.get(c.req.param('id')) }))

personasRoutes.patch('/:id', async (c) => c.json({
  data: personaService.update(c.req.param('id'), await readJson(c)),
}))

personasRoutes.delete('/:id', (c) => {
  personaService.remove(c.req.param('id'))
  return c.body(null, 204)
})