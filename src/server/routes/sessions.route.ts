import { Router, Request, Response } from 'express'
import { sessionRepo } from '../db/repositories/session.repo'
import { messageRepo } from '../db/repositories/message.repo'

export const sessionsRouter = Router()

sessionsRouter.get('/', (_req: Request, res: Response) => {
  res.json({ data: sessionRepo.list() })
})

sessionsRouter.post('/', (req: Request, res: Response) => {
  const session = sessionRepo.create(req.body || {})
  res.status(201).json({ data: session })
})

sessionsRouter.get('/:id', (req: Request, res: Response) => {
  const session = sessionRepo.get(req.params.id)
  if (!session) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found' } })
  res.json({ data: session })
})

sessionsRouter.patch('/:id', (req: Request, res: Response) => {
  const session = sessionRepo.update(req.params.id, req.body)
  if (!session) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found' } })
  res.json({ data: session })
})

sessionsRouter.delete('/:id', (req: Request, res: Response) => {
  sessionRepo.delete(req.params.id)
  res.status(204).send()
})

sessionsRouter.get('/:id/messages', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 100
  const offset = parseInt(req.query.offset as string) || 0
  const messages = messageRepo.list(req.params.id, limit, offset)
  const total = messageRepo.count(req.params.id)
  res.json({ data: messages, meta: { total, limit, offset } })
})
