import { Router, Request, Response } from 'express'
import { toolRepo } from '../db/repositories/tool.repo'
import { executeTool } from '../services/tool.service'

export const toolsRouter = Router()

toolsRouter.get('/', (req: Request, res: Response) => {
  const category = req.query.category as string | undefined
  const tools = toolRepo.list(category)
  const permissions = toolRepo.listPermissions()
  const permMap = Object.fromEntries(permissions.map(p => [p.tool_id, p]))
  res.json({ data: tools.map(t => ({ ...t, permission: permMap[t.id] || null })) })
})
toolsRouter.get('/stats', (_req: Request, res: Response) => res.json({ data: toolRepo.getStats() }))
toolsRouter.get('/runs', (req: Request, res: Response) => res.json({ data: toolRepo.listAllRuns(parseInt(req.query.limit as string) || 100) }))
toolsRouter.get('/permissions', (_req: Request, res: Response) => res.json({ data: toolRepo.listPermissions() }))
toolsRouter.post('/permissions/:id/grant', (req: Request, res: Response) => {
  toolRepo.grantPermission(req.params.id, req.body.scope || 'session')
  res.json({ data: { tool_id: req.params.id, granted: true, scope: req.body.scope || 'session' } })
})
toolsRouter.post('/permissions/:id/revoke', (req: Request, res: Response) => {
  toolRepo.revokePermission(req.params.id)
  res.json({ data: { tool_id: req.params.id, granted: false } })
})
toolsRouter.get('/:id', (req: Request, res: Response) => {
  const tool = toolRepo.get(req.params.id)
  if (!tool) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tool not found' } })
  res.json({ data: { ...tool, permission: toolRepo.getPermission(req.params.id) || null } })
})
toolsRouter.patch('/:id', (req: Request, res: Response) => {
  if (typeof req.body.is_enabled === 'boolean') toolRepo.setEnabled(req.params.id, req.body.is_enabled)
  res.json({ data: toolRepo.get(req.params.id) })
})
toolsRouter.post('/:id/run', async (req: Request, res: Response) => {
  try {
    const result = await executeTool(req.params.id, req.body.input || {}, req.body.sessionId)
    res.json({ data: result })
  } catch (err: any) { res.status(500).json({ error: { code: 'TOOL_ERROR', message: err.message } }) }
})
toolsRouter.get('/:id/runs', (req: Request, res: Response) => res.json({ data: toolRepo.listRuns(req.params.id, parseInt(req.query.limit as string) || 50) }))
