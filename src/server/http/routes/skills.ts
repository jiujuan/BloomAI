import { Hono } from 'hono'
import { skillRepo } from '../../db/repositories/skill.repo'
import { runSkill } from '../../skills/run-skill'
import { readJson, readIntQuery } from '../util'

export const skillsRoutes = new Hono()

skillsRoutes.get('/', (c) => c.json({ data: skillRepo.listInstalled() }))

skillsRoutes.get('/market', (c) => {
  const limit = readIntQuery(c, 'limit', 20)
  const data = skillRepo.listMarket(c.req.query('q') || undefined, limit, readIntQuery(c, 'offset', 0))
  return c.json({ data, meta: { limit } })
})

skillsRoutes.post('/install', async (c) => {
  const { id } = await readJson<any>(c)
  if (!skillRepo.get(id)) return c.json({ error: { code: 'NOT_FOUND', message: 'Skill not found' } }, 404)
  skillRepo.install(id)
  return c.json({ data: skillRepo.get(id) })
})

skillsRoutes.post('/', async (c) => {
  const { name, description, type, source, params_schema } = await readJson<any>(c)
  if (!name || !description || !type || !source) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'name, description, type, source required' } }, 400)
  }
  if (!['js-function', 'http-api', 'prompt-template'].includes(type)) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'invalid type' } }, 400)
  }
  return c.json({ data: skillRepo.create({ name, description, type, source, params_schema }) }, 201)
})

skillsRoutes.get('/:id', (c) => {
  const skill = skillRepo.get(c.req.param('id'))
  if (!skill) return c.json({ error: { code: 'NOT_FOUND', message: 'Skill not found' } }, 404)
  return c.json({ data: skill })
})

skillsRoutes.patch('/:id', async (c) => {
  const skill = skillRepo.update(c.req.param('id'), await readJson(c))
  if (!skill) return c.json({ error: { code: 'NOT_FOUND', message: 'Skill not found' } }, 404)
  return c.json({ data: skill })
})

skillsRoutes.delete('/:id', (c) => {
  const skill = skillRepo.get(c.req.param('id'))
  if (!skill) return c.json({ error: { code: 'NOT_FOUND', message: 'Skill not found' } }, 404)
  if (skill.author === 'official') {
    skillRepo.uninstall(c.req.param('id'))
    return c.json({ data: { uninstalled: true } })
  }
  skillRepo.delete(c.req.param('id'))
  return c.body(null, 204)
})

skillsRoutes.post('/:id/run', async (c) => {
  try {
    return c.json({ data: await runSkill(c.req.param('id'), (await readJson<any>(c)).input || {}) })
  } catch (err: any) {
    return c.json({ error: { code: 'SKILL_ERROR', message: err.message } }, 500)
  }
})

skillsRoutes.get('/:id/runs', (c) => c.json({ data: skillRepo.listRuns(c.req.param('id'), readIntQuery(c, 'limit', 20)) }))
