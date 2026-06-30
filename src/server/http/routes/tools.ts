import { Hono } from 'hono'
import { toolRepo } from '../../db/repositories/tool.repo'
import { executeTool } from '../../tools/execute-tool'
import { readJson, readIntQuery } from '../util'

export const toolsRoutes = new Hono()

toolsRoutes.get('/', (c) => {
  const category = c.req.query('category') || undefined
  const tools = toolRepo.list(category)
  const permMap = Object.fromEntries(toolRepo.listPermissions().map((p) => [p.tool_id, p]))
  return c.json({ data: tools.map((t) => ({ ...t, permission: permMap[t.id] || null })) })
})

toolsRoutes.get('/stats', (c) => c.json({ data: toolRepo.getStats() }))
toolsRoutes.get('/runs', (c) => c.json({ data: toolRepo.listAllRuns(readIntQuery(c, 'limit', 100)) }))
toolsRoutes.get('/permissions', (c) => c.json({ data: toolRepo.listPermissions() }))

toolsRoutes.post('/permissions/:id/grant', async (c) => {
  const scope = (await readJson<any>(c)).scope || 'session'
  toolRepo.grantPermission(c.req.param('id'), scope)
  return c.json({ data: { tool_id: c.req.param('id'), granted: true, scope } })
})

toolsRoutes.post('/permissions/:id/revoke', (c) => {
  toolRepo.revokePermission(c.req.param('id'))
  return c.json({ data: { tool_id: c.req.param('id'), granted: false } })
})

toolsRoutes.get('/:id', (c) => {
  const tool = toolRepo.get(c.req.param('id'))
  if (!tool) return c.json({ error: { code: 'NOT_FOUND', message: 'Tool not found' } }, 404)
  return c.json({ data: { ...tool, permission: toolRepo.getPermission(c.req.param('id')) || null } })
})

toolsRoutes.patch('/:id', async (c) => {
  const body = await readJson<any>(c)
  if (typeof body.is_enabled === 'boolean') toolRepo.setEnabled(c.req.param('id'), body.is_enabled)
  return c.json({ data: toolRepo.get(c.req.param('id')) })
})

toolsRoutes.post('/:id/run', async (c) => {
  const body = await readJson<any>(c)
  try {
    return c.json({ data: await executeTool(c.req.param('id'), body.input || {}, body.sessionId) })
  } catch (err: any) {
    return c.json({ error: { code: 'TOOL_ERROR', message: err.message } }, 500)
  }
})

toolsRoutes.get('/:id/runs', (c) => c.json({ data: toolRepo.listRuns(c.req.param('id'), readIntQuery(c, 'limit', 50)) }))
