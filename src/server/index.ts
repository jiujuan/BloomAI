import { serve } from '@hono/node-server'
import { loadDotEnv } from './config/load-env'
import { createHonoApp } from './http/app'
import { runMigrations } from './db/client'
import { API_HOST, BLOOMAI_PORT_ENV, DEFAULT_SERVER_PORT } from '../shared/constants'

loadDotEnv()

const PORT = parseInt(process.env[BLOOMAI_PORT_ENV] || String(DEFAULT_SERVER_PORT), 10)

console.log('[BloomAI Server] Boot (Hono)', { cwd: process.cwd(), port: PORT })

runMigrations()
  .then(() => {
    const app = createHonoApp()
    serve({ fetch: app.fetch, port: PORT, hostname: API_HOST }, (info) => {
      console.log(`[BloomAI Server] Hono running on http://${API_HOST}:${info.port}`)
    })
  })
  .catch((err) => {
    console.error('[BloomAI Server] Failed to start', err)
    process.exit(1)
  })

process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
