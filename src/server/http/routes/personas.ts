import { Hono } from 'hono'
import { personaRepo } from '../../db/repositories/persona.repo'
import { readJson } from '../util'

export const personasRoutes = new Hono()

personasRoutes.get('/', (c) => c.json({ data: personaRepo.list() }))

personasRoutes.post('/', async (c) => {
  const { name, system_prompt, model_override } = await readJson<any>(c)
  if (!name || !system_prompt) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'name and system_prompt are required' } }, 400)
  }
  return c.json({ data: personaRepo.create({ name, system_prompt, model_override }) }, 201)
})

personasRoutes.get('/:id', (c) => {
  const persona = personaRepo.get(c.req.param('id'))
  if (!persona) return c.json({ error: { code: 'NOT_FOUND', message: 'Persona not found' } }, 404)
  return c.json({ data: persona })
})

personasRoutes.patch('/:id', async (c) => {
  const persona = personaRepo.update(c.req.param('id'), await readJson(c))
  if (!persona) return c.json({ error: { code: 'NOT_FOUND', message: 'Persona not found' } }, 404)
  return c.json({ data: persona })
})

personasRoutes.delete('/:id', (c) => {
  const ok = personaRepo.delete(c.req.param('id'))
  if (!ok) return c.json({ error: { code: 'FORBIDDEN', message: 'Cannot delete built-in persona' } }, 400)
  return c.body(null, 204)
})
