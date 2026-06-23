import { Router, Request, Response } from 'express'
import { db } from '../db/client'

export const settingsRouter = Router()

settingsRouter.get('/', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]))
  // Mask API keys
  if (settings.anthropic_api_key) settings.anthropic_api_key = settings.anthropic_api_key ? '***masked***' : ''
  if (settings.openai_api_key) settings.openai_api_key = settings.openai_api_key ? '***masked***' : ''
  if (settings.agnes_api_key) settings.agnes_api_key = settings.agnes_api_key ? '***masked***' : ''
  if (settings.deepseek_api_key) settings.deepseek_api_key = settings.deepseek_api_key ? '***masked***' : ''
  res.json({ data: settings })
})

settingsRouter.patch('/', (req: Request, res: Response) => {
  const updates = req.body as Record<string, string>
  const update = db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
  const updateMany = db.transaction((entries: Array<[string, string]>) => {
    for (const [key, value] of entries) update.run(key, value, Date.now())
  })
  updateMany(Object.entries(updates))
  res.json({ data: { updated: Object.keys(updates).length } })
})

settingsRouter.get('/:key', (req: Request, res: Response) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(req.params.key) as any
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Setting not found' } })
  res.json({ data: { key: req.params.key, value: row.value } })
})
