import { Router, Request, Response } from 'express'
import { settingsRepo } from '../db/repositories/settings.repo'

export const settingsRouter = Router()

settingsRouter.get('/', async (_req: Request, res: Response) => {
  const settings = await settingsRepo.list()
  // Mask API keys
  if (settings.anthropic_api_key) settings.anthropic_api_key = settings.anthropic_api_key ? '***masked***' : ''
  if (settings.openai_api_key) settings.openai_api_key = settings.openai_api_key ? '***masked***' : ''
  if (settings.agnes_api_key) settings.agnes_api_key = settings.agnes_api_key ? '***masked***' : ''
  if (settings.deepseek_api_key) settings.deepseek_api_key = settings.deepseek_api_key ? '***masked***' : ''
  res.json({ data: settings })
})

settingsRouter.patch('/', async (req: Request, res: Response) => {
  const updates = req.body as Record<string, string>
  const updated = await settingsRepo.setMany(updates)
  res.json({ data: { updated } })
})

settingsRouter.get('/:key', async (req: Request, res: Response) => {
  const value = await settingsRepo.getValue(req.params.key)
  if (value === undefined) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Setting not found' } })
  res.json({ data: { key: req.params.key, value } })
})