import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logError } from '../logger/logger'
import { chatRoutes } from './routes/chat'
import { sessionsRoutes } from './routes/sessions'
import { personasRoutes } from './routes/personas'
import { settingsRoutes } from './routes/settings'
import { llmRoutes } from './routes/llm'
import { toolsRoutes } from './routes/tools'
import { skillsRoutes } from './routes/skills'
import { imageStudioRoutes } from './routes/images'
import { attachmentsRoutes } from './routes/attachments'

/**
 * Single Hono HTTP server for BloomAI — replaces the previous Express app.
 * Chat streaming runs through Mastra (AI SDK v6); CRUD routes wrap the existing
 * SQLite repositories. Served via @hono/node-server (see ../index.ts).
 */
export function createHonoApp(): Hono {
  const app = new Hono()

  app.use('*', cors({ origin: '*' }))

  app.get('/health', (c) => c.json({ status: 'ok', version: '0.3.0', server: 'hono' }))

  app.route('/api/v1/chat', chatRoutes)
  app.route('/api/v1/sessions', sessionsRoutes)
  app.route('/api/v1/personas', personasRoutes)
  app.route('/api/v1/settings', settingsRoutes)
  app.route('/api/v1/llm', llmRoutes)
  app.route('/api/v1/tools', toolsRoutes)
  app.route('/api/v1/skills', skillsRoutes)
  app.route('/api/v1/attachments', attachmentsRoutes)
  app.route('/api/v1', imageStudioRoutes)

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404))

  app.onError((err, c) => {
    console.error('[Error]', err.message)
    logError('http.error', err, { method: c.req.method, path: c.req.path })
    const status = (err as any).statusCode || (err as any).status || 500
    return c.json({ error: { code: (err as any).code || 'INTERNAL_ERROR', message: err.message || 'Internal server error' } }, status)
  })

  return app
}
