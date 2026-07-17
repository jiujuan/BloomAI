import { execSync } from 'child_process'
import { serve } from '@hono/node-server'
import { loadDotEnv } from './config/load-env'
import { createHonoApp } from './http/app'
import { runMigrations } from './db/client'
import { SkillRunCoordinator } from './skills/runtime'
import { getDeepResearchModule } from './deepresearch'
import { API_HOST, BLOOMAI_PORT_ENV, DEFAULT_SERVER_PORT } from '../shared/constants'
import { serverLogger } from './logger/logger'
import { initTracing, shutdownTracing } from './telemetry/tracer'
import { initMetrics, shutdownMetrics } from './telemetry/metrics'

// On Windows, switch the attached console to UTF-8 so Chinese characters in
// log output are not garbled (Windows default code page is GBK/CP936).
if (process.platform === 'win32') {
  try { execSync('chcp 65001', { stdio: 'ignore' }) } catch { /* no console attached */ }
}

loadDotEnv()
initTracing() // start OTel TracerProvider before any requests arrive
initMetrics() // start OTel MeterProvider after tracing (both need loadDotEnv first)

const PORT = parseInt(process.env[BLOOMAI_PORT_ENV] || String(DEFAULT_SERVER_PORT), 10)

serverLogger.info('BloomAI Server starting', { cwd: process.cwd(), port: PORT })

runMigrations()
  .then(async () => {
    const interrupted = new SkillRunCoordinator().markInterruptedRuns()
    if (interrupted > 0) serverLogger.warn('Marked interrupted skill runs after restart', { count: interrupted })
    const recovered = await getDeepResearchModule().recoverInterruptedRuns()
    if (recovered.interrupted.length > 0) serverLogger.warn('Recovered interrupted Deep Research runs after restart', { count: recovered.interrupted.length })
    if (recovered.skipped.length > 0) serverLogger.warn('Skipped Deep Research recovery conflicts after restart', { count: recovered.skipped.length })
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
