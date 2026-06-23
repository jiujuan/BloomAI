import { Router, Request, Response } from 'express'
import { skillRepo } from '../db/repositories/skill.repo'
import { runSkill } from '../skills/run-skill'

export const skillsRouter = Router()

skillsRouter.get('/', (_req: Request, res: Response) => res.json({ data: skillRepo.listInstalled() }))
skillsRouter.get('/market', (req: Request, res: Response) => {
  const data = skillRepo.listMarket(req.query.q as string | undefined, parseInt(req.query.limit as string) || 20, parseInt(req.query.offset as string) || 0)
  res.json({ data, meta: { limit: parseInt(req.query.limit as string) || 20 } })
})
skillsRouter.post('/install', (req: Request, res: Response) => {
  const skill = skillRepo.get(req.body.id)
  if (!skill) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Skill not found' } })
  skillRepo.install(req.body.id)
  res.json({ data: skillRepo.get(req.body.id) })
})
skillsRouter.post('/', (req: Request, res: Response) => {
  const { name, description, type, source, params_schema } = req.body
  if (!name || !description || !type || !source) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'name, description, type, source required' } })
  if (!['js-function','http-api','prompt-template'].includes(type)) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'invalid type' } })
  res.status(201).json({ data: skillRepo.create({ name, description, type, source, params_schema }) })
})
skillsRouter.get('/:id', (req: Request, res: Response) => {
  const skill = skillRepo.get(req.params.id)
  if (!skill) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Skill not found' } })
  res.json({ data: skill })
})
skillsRouter.patch('/:id', (req: Request, res: Response) => {
  const skill = skillRepo.update(req.params.id, req.body)
  if (!skill) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Skill not found' } })
  res.json({ data: skill })
})
skillsRouter.delete('/:id', (req: Request, res: Response) => {
  const skill = skillRepo.get(req.params.id)
  if (!skill) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Skill not found' } })
  if (skill.author === 'official') { skillRepo.uninstall(req.params.id); return res.json({ data: { uninstalled: true } }) }
  skillRepo.delete(req.params.id)
  res.status(204).send()
})
skillsRouter.post('/:id/run', async (req: Request, res: Response) => {
  try { res.json({ data: await runSkill(req.params.id, req.body.input || {}) }) }
  catch (err: any) { res.status(500).json({ error: { code: 'SKILL_ERROR', message: err.message } }) }
})
skillsRouter.get('/:id/runs', (req: Request, res: Response) => res.json({ data: skillRepo.listRuns(req.params.id, parseInt(req.query.limit as string) || 20) }))

