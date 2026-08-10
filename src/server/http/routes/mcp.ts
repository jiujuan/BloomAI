import { Hono, type Context } from 'hono'
import { getSkillRole } from '../skills-policy'
import { readJson } from '../util'
import { McpError } from '../../mcp/errors'
import {
  McpService,
  toSafeMcpPreview,
  toSafeMcpResult,
  toSafeMcpRun,
  toSafeMcpServer,
  toSafeMcpTool,
} from '../../mcp/mcp.service'
import { isMcpRunStatus, type McpRunStatus } from '../../mcp/types'

/**
 * HTTP facade for MCP management. Authentication and transport parsing belong
 * here; policy, feature flags, persistence and safe DTO shaping remain in the
 * McpService so that non-HTTP callers cannot bypass the same boundary.
 */
export function createMcpRoutes(service: McpService): Hono {
  const routes = new Hono()

  routes.use('*', async (context, next) => {
    const role = getSkillRole(context.req.header('x-bloom-role'))
    if (role !== 'admin' && role !== 'owner') {
      return context.json({
        error: {
          code: 'FORBIDDEN',
          message: 'MCP management requires administrator access',
        },
      }, 403)
    }
    await next()
  })

  routes.get('/servers', (context) => context.json({
    data: service.listServers().map(toSafeMcpServer),
  }))

  routes.post('/servers', async (context) => {
    const body = asRecord(await readJson<unknown>(context))
    const server = service.createServer({
      id: body.id,
      name: body.name,
      transportKind: body.transportKind,
      config: body.config,
    })
    return context.json({ data: toSafeMcpServer(server) }, 201)
  })

  routes.get('/servers/:serverId', (context) => {
    const server = service.getServer(pathParam(context, 'serverId'))
    return context.json({ data: toSafeMcpServer(server) })
  })

  routes.patch('/servers/:serverId', async (context) => {
    const body = asRecord(await readJson<unknown>(context))
    const patch: {
      name?: unknown
      transportKind?: unknown
      config?: unknown
    } = {}
    if (hasOwn(body, 'name')) patch.name = body.name
    if (hasOwn(body, 'transportKind')) patch.transportKind = body.transportKind
    if (hasOwn(body, 'config')) patch.config = body.config
    const server = service.updateServer(pathParam(context, 'serverId'), patch)
    return context.json({ data: toSafeMcpServer(server) })
  })

  routes.delete('/servers/:serverId', (context) => {
    return context.json({ data: service.deleteServer(pathParam(context, 'serverId')) })
  })

  routes.post('/servers/:serverId/test-connection', async (context) => {
    const result = await service.testConnection(pathParam(context, 'serverId'), context.req.raw.signal)
    return context.json({
      data: {
        server: toSafeMcpServer(result.server),
        tools: result.tools,
      },
    })
  })

  routes.post('/servers/:serverId/tools/preview', async (context) => {
    const preview = await service.previewTools(pathParam(context, 'serverId'), context.req.raw.signal)
    return context.json({ data: toSafeMcpPreview(preview) })
  })

  routes.post('/servers/:serverId/tools/confirm', async (context) => {
    const body = asRecord(await readJson<unknown>(context))
    const result = service.confirmTools({
      serverId: pathParam(context, 'serverId'),
      ...(hasOwn(body, 'previewId') ? { previewId: body.previewId as string } : {}),
      previewHash: body.previewHash as string,
      configHash: body.configHash as string,
      catalogVersion: body.catalogVersion as string,
    })
    return context.json({
      data: {
        server: toSafeMcpServer(result.server),
        tools: result.tools.map(toSafeMcpTool),
      },
    })
  })

  routes.post('/servers/:serverId/enable', (context) => {
    const server = service.enableServer(pathParam(context, 'serverId'))
    return context.json({ data: toSafeMcpServer(server) })
  })

  routes.post('/servers/:serverId/disable', (context) => {
    const server = service.disableServer(pathParam(context, 'serverId'))
    return context.json({ data: toSafeMcpServer(server) })
  })

  routes.post('/servers/:serverId/trust', async (context) => {
    const body = asRecord(await readJson<unknown>(context))
    const server = service.trustServer(pathParam(context, 'serverId'), body.trustLevel)
    return context.json({ data: toSafeMcpServer(server) })
  })

  routes.get('/servers/:serverId/tools', (context) => {
    const includeRemoved = parseBooleanQuery(context.req.query('includeRemoved'))
    const tools = service.listTools(pathParam(context, 'serverId'), { includeRemoved })
    return context.json({ data: tools.map(toSafeMcpTool) })
  })

  routes.patch('/servers/:serverId/tools/:toolId', async (context) => {
    const body = asRecord(await readJson<unknown>(context))
    const patch: { enabled?: unknown; isEnabled?: unknown } = {}
    if (hasOwn(body, 'enabled')) patch.enabled = body.enabled
    if (hasOwn(body, 'isEnabled')) patch.isEnabled = body.isEnabled
    const tool = service.updateTool(
      pathParam(context, 'serverId'),
      pathParam(context, 'toolId'),
      patch,
    )
    return context.json({ data: toSafeMcpTool(tool) })
  })

  routes.post('/servers/:serverId/tools/:toolId/test', async (context) => {
    const body = asRecord(await readJson<unknown>(context))
    const result = await service.testTool(
      pathParam(context, 'serverId'),
      pathParam(context, 'toolId'),
      hasOwn(body, 'input') ? body.input : {},
      {
        // Session identity is transport-derived. Never accept a session ID or
        // approval token from the request body.
        sessionId: context.req.header('x-bloom-session') ?? '',
        signal: context.req.raw.signal,
      },
    )
    return context.json({
      data: {
        status: result.status,
        result: toSafeMcpResult(result.result),
        run: toSafeMcpRun(result.run),
      },
    })
  })

  routes.post('/servers/:serverId/approvals/:requestId/approve', async (context) => {
    const result = await service.approve(
      pathParam(context, 'serverId'),
      pathParam(context, 'requestId'),
      { signal: context.req.raw.signal },
    )
    return context.json({
      data: {
        status: result.status,
        result: toSafeMcpResult(result.result),
        run: toSafeMcpRun(result.run),
      },
    })
  })

  routes.post('/servers/:serverId/approvals/:requestId/deny', async (context) => {
    const result = await service.deny(
      pathParam(context, 'serverId'),
      pathParam(context, 'requestId'),
    )
    return context.json({
      data: {
        status: result.status,
        run: toSafeMcpRun(result.run),
      },
    })
  })

  routes.get('/servers/:serverId/runs', (context) => {
    const status = parseRunStatus(context.req.query('status'))
    const limit = parseLimit(context.req.query('limit'))
    const runs = service.listRuns(pathParam(context, 'serverId'), {
      ...(context.req.query('toolId') === undefined ? {} : { toolId: context.req.query('toolId') }),
      ...(status === undefined ? {} : { status }),
      ...(limit === undefined ? {} : { limit }),
    })
    return context.json({ data: runs.map(toSafeMcpRun) })
  })

  return routes
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new McpError('MCP_CONFIG_INVALID')
  }
  return value as Record<string, unknown>
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function pathParam(context: Context, key: string): string {
  const raw = context.req.param(key)
  if (raw === undefined) throw new McpError('MCP_CONFIG_INVALID')
  try {
    return decodeURIComponent(raw)
  } catch (error) {
    throw new McpError('MCP_CONFIG_INVALID', { cause: error })
  }
}

function parseBooleanQuery(value: string | undefined): boolean {
  if (value === undefined) return false
  if (value === 'true') return true
  if (value === 'false') return false
  throw new McpError('MCP_CONFIG_INVALID')
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!/^\d+$/.test(value)) throw new McpError('MCP_CONFIG_INVALID')
  const limit = Number(value)
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new McpError('MCP_CONFIG_INVALID')
  return limit
}

function parseRunStatus(value: string | undefined): McpRunStatus | undefined {
  if (value === undefined) return undefined
  if (!isMcpRunStatus(value)) throw new McpError('MCP_CONFIG_INVALID')
  return value
}
