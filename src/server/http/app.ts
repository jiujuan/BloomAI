import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logError, serverLogger } from '../logger/logger'
import { createHttpErrorHandler } from './error-mapper'
import { getTracer, SpanStatusCode } from '../telemetry/tracer'
import { getMeter } from '../telemetry/metrics'
import { chatRoutes } from './routes/chat'
import { sessionsRoutes } from './routes/sessions'
import { projectsRoutes } from './routes/projects'
import { personasRoutes } from './routes/personas'
import { settingsRoutes } from './routes/settings'
import { llmRoutes } from './routes/llm'
import { toolsRoutes } from './routes/tools'
import { skillPackageRuntimeRoutes } from './routes/skill-package-runtime'
import { skillsRoutes } from './routes/skills'
import { skillMigrationRoutes } from './routes/skill-migration'
import { imageStudioRoutes } from './routes/images'
import { attachmentsRoutes } from './routes/attachments'
import { articleIllustrationRoutes } from './routes/article-illustrations'
import { deepResearchRoutes } from './routes/deep-research'
import { schedulesRoutes } from './routes/schedules'
import { skillCreatorRoutes } from './routes/skill-creator'
import { skillSecurityRoutes } from './routes/skill-security'
import { createSkillRuntimeObservabilityRoutes, type SkillRuntimeObservabilityRouteOptions } from './routes/skill-runtime-observability'
import { isAllowedBrowserOrigin } from '../skills/security/skill-security-checklist'

/**
 * Single Hono HTTP server for BloomAI 鈥?replaces the previous Express app.
 * Chat streaming runs through Mastra (AI SDK v6); CRUD routes wrap the existing
 * SQLite repositories. Served via @hono/node-server (see ../index.ts).
 */
export type HonoAppOptions = {
  skillRuntimeObservability?: SkillRuntimeObservabilityRouteOptions
}

export function createHonoApp(options: HonoAppOptions = {}): Hono {
  const app = new Hono()
  const httpTracer = getTracer('bloomai.http')
  // Lazily created on first request 鈥?after initMetrics() has registered the global MeterProvider.
  let _httpDuration: ReturnType<ReturnType<typeof getMeter>['createHistogram']> | null = null

  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin')
    if (origin && !isAllowedBrowserOrigin(origin)) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Browser origin is not allowed' } }, 403)
    }
    await next()
  })
  app.use('*', cors({ origin: (origin) => isAllowedBrowserOrigin(origin) ? origin : undefined }))

  // HTTP trace span 鈥?must come before the access-log middleware so the span wraps the full request.
  app.use('*', async (c, next) => {
    const span = httpTracer.startSpan(`${c.req.method} ${c.req.path}`, {
      attributes: { 'http.method': c.req.method, 'http.route': c.req.path },
    })
    try {
      await next()
      span.setAttribute('http.status_code', c.res.status)
      if (c.res.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR })
    } catch (err: any) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
      span.recordException(err)
      throw err
    } finally {
      span.end()
    }
  })

  // Access log: method + path + status + duration on every request. Also records HTTP duration metric.
  app.use('*', async (c, next) => {
    const start = Date.now()
    await next()
    const elapsed = Date.now() - start
    serverLogger.info(`${c.req.method} ${c.req.path} ${c.res.status} ${elapsed}ms`)
    if (!_httpDuration) {
      _httpDuration = getMeter('bloomai.http').createHistogram('bloomai.http.request.duration_ms', {
        unit: 'ms',
        description: 'HTTP request duration',
      })
    }
    _httpDuration.record(elapsed, {
      method: c.req.method,
      route: c.req.path,
      status_code: String(c.res.status),
    })
  })

  app.get('/health', (c) => c.json({ status: 'ok', version: '0.3.0', server: 'hono' }))

  app.route('/api/v1/chat', chatRoutes)
  app.route('/api/v1/projects', projectsRoutes)
  app.route('/api/v1/sessions', sessionsRoutes)
  app.route('/api/v1/personas', personasRoutes)
  app.route('/api/v1/settings', settingsRoutes)
  app.route('/api/v1/llm', llmRoutes)
  app.route('/api/v1/tools', toolsRoutes)
  app.route('/api/v1', skillMigrationRoutes)
  app.route('/api/v1/skills', skillsRoutes)
  app.route('/api/v1/attachments', attachmentsRoutes)
  app.route('/api/v1', skillPackageRuntimeRoutes)
  app.route('/api/v1', skillCreatorRoutes)
  app.route('/api/v1', skillSecurityRoutes)
  app.route('/api/v1', createSkillRuntimeObservabilityRoutes(options.skillRuntimeObservability))
  app.route('/api/v1', imageStudioRoutes)
  app.route('/api/v1', articleIllustrationRoutes)
  app.route('/api/v1/deep-research', deepResearchRoutes)
  app.route('/api/v1/schedules', schedulesRoutes)

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404))

  app.onError(createHttpErrorHandler(logError))

  return app
}
