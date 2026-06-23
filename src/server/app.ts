import express from 'express'
import cors from 'cors'
import { chatRouter } from './routes/chat.route'
import { sessionsRouter } from './routes/sessions.route'
import { personasRouter } from './routes/personas.route'
import { settingsRouter } from './routes/settings.route'
import { toolsRouter } from './routes/tools.route'
import { skillsRouter } from './routes/skills.route'
import { errorMiddleware, notFound } from './middleware/index'
import { runMigrations } from './db/client'

export async function createApp() {
  await runMigrations()
  const app = express()
  app.use(cors({ origin: '*' }))
  app.use(express.json({ limit: '10mb' }))
  app.use('/api/v1/chat', chatRouter)
  app.use('/api/v1/sessions', sessionsRouter)
  app.use('/api/v1/personas', personasRouter)
  app.use('/api/v1/settings', settingsRouter)
  app.use('/api/v1/tools', toolsRouter)
  app.use('/api/v1/skills', skillsRouter)
  app.get('/health', (_req, res) => res.json({ status: 'ok', version: '0.2.0' }))
  app.use(notFound)
  app.use(errorMiddleware)
  return app
}
