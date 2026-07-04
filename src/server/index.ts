import { serve } from '@hono/node-server'
import { loadDotEnv } from './config/load-env'
import { createHonoApp } from './http/app'
import { runMigrations } from './db/client'
import { API_HOST, BLOOMAI_PORT_ENV, DEFAULT_SERVER_PORT } from '../shared/constants'
import { serverLogger } from './logger/logger'
import { initTracing, shutdownTracing } from './telemetry/tracer'
import { initMetrics, shutdownMetrics } from './telemetry/metrics'

loadDotEnv()
initTracing() // start OTel TracerProvider before any requests arrive
initMetrics() // start OTel MeterProvider after tracing (both need loadDotEnv first)

const PORT = parseInt(process.env[BLOOMAI_PORT_ENV] || String(DEFAULT_SERVER_PORT), 10)

serverLogger.info('BloomAI Server starting', { cwd: process.cwd(), port: PORT })

runMigrations()
  .then(() => {
    const app = createHonoApp()
    serve({ fetch: app.fetch, port: PORT, hostname: API_HOST }, (info) => {
      serverLogger.info(`BloomAI Server ready on http://${API_HOST}:${info.port}`)
    })
  })
  .catch((err) => {
    serverLogger.error('BloomAI Server failed to start', { error: err?.message ?? String(err) })
    process.exit(1)
  })

const gracefulShutdown = () =>
  Promise.all([shutdownTracing(), shutdownMetrics()]).finally(() => process.exit(0))
process.on('SIGTERM', gracefulShutdown)
process.on('SIGINT', gracefulShutdown)
