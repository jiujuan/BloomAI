import { Router, Request, Response } from 'express'
import { personaRepo } from '../db/repositories/persona.repo'

export const personasRouter = Router()

personasRouter.get('/', (_req: Request, res: Response) => {
  res.json({ data: personaRepo.list() })
})

personasRouter.post('/', (req: Request, res: Response) => {
  const { name, system_prompt, model_override } = req.body
  if (!name || !system_prompt) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'name and system_prompt are required' } })
  }
  const persona = personaRepo.create({ name, system_prompt, model_override })
  res.status(201).json({ data: persona })
})

personasRouter.get('/:id', (req: Request, res: Response) => {
  const persona = personaRepo.get(req.params.id)
  if (!persona) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Persona not found' } })
  res.json({ data: persona })
})

personasRouter.patch('/:id', (req: Request, res: Response) => {
  const persona = personaRepo.update(req.params.id, req.body)
  if (!persona) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Persona not found' } })
  res.json({ data: persona })
})

personasRouter.delete('/:id', (req: Request, res: Response) => {
  const ok = personaRepo.delete(req.params.id)
  if (!ok) return res.status(400).json({ error: { code: 'FORBIDDEN', message: 'Cannot delete built-in persona' } })
  res.status(204).send()
})
