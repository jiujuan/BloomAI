import { Hono } from 'hono'
import { mapErrorToHttpResponse } from '../error-mapper'
import { toolService } from '../../services/tool.service'
import { readJson, readIntQuery } from '../util'

export const toolsRoutes = new Hono()

toolsRoutes.get('/', (c) => {
  try {
    return c.json({ data: toolService.list({ category: c.req.query('category') || undefined }) })
  } catch (error) { return errorResponse(c, error) }
})

toolsRoutes.get('/stats', (c) => {
  try { return c.json({ data: toolService.getStats() }) } catch (error) { return errorResponse(c, error) }
})
toolsRoutes.get('/runs', (c) => {
  try { return c.json({ data: toolService.listAllRuns(readIntQuery(c, 'limit', 100)) }) } catch (error) { return errorResponse(c, error) }
})
toolsRoutes.get('/permissions', (c) => {
  try { return c.json({ data: toolService.listPermissions() }) } catch (error) { return errorResponse(c, error) }
})

toolsRoutes.post('/permissions/:id/grant', async (c) => {
  try {
    const body = await readJson<any>(c)
    return c.json({ data: toolService.grantPermission(c.req.param('id'), body.scope) })
  } catch (error) { return errorResponse(c, error) }
})

toolsRoutes.post('/permissions/:id/revoke', (c) => {
  try { return c.json({ data: toolService.revokePermission(c.req.param('id')) }) } catch (error) { return errorResponse(c, error) }
})

toolsRoutes.get('/:id/runs/:runId/artifact', async (c) => {
  try {
    const artifact = await toolService.getArtifact(
      c.req.param('id'),
      c.req.param('runId'),
      c.req.query('path') || undefined,
    )
    return new Response(Uint8Array.from(artifact.bytes), {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Length': String(artifact.bytes.byteLength),
        'Content-Type': artifact.mimeType,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) { return errorResponse(c, error) }
})

toolsRoutes.get('/:id', (c) => {
  try { return c.json({ data: toolService.get(c.req.param('id')) }) } catch (error) { return errorResponse(c, error) }
})

toolsRoutes.patch('/:id', async (c) => {
  try {
    const body = await readJson<any>(c)
    return c.json({ data: toolService.setEnabled(c.req.param('id'), body.is_enabled) })
  } catch (error) { return errorResponse(c, error) }
})

toolsRoutes.post('/:id/run', async (c) => {
  try {
    const result = await toolService.run(c.req.param('id'), await readJson<any>(c), c.req.raw.signal)
    return c.json({ data: result.output, meta: { toolRunId: result.toolRunId } })
  } catch (error) { return errorResponse(c, error) }
})

toolsRoutes.get('/:id/runs', (c) => {
  try { return c.json({ data: toolService.listRuns(c.req.param('id'), readIntQuery(c, 'limit', 50)) }) } catch (error) { return errorResponse(c, error) }
})

function errorResponse(c: any, error: unknown) {
  const response = mapErrorToHttpResponse(error)
  return c.json(response.body, response.status)
}
