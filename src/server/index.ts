import fs from 'node:fs'
import path from 'node:path'
import { createApp } from './app'
import { API_HOST, BLOOMAI_PORT_ENV, DEFAULT_SERVER_PORT } from '../shared/constants'

const PORT = parseInt(process.env[BLOOMAI_PORT_ENV] || String(DEFAULT_SERVER_PORT), 10)
const dotEnvPath = path.join(process.cwd(), '.env')

console.log('[BloomAI Server] Boot diagnostics', {
  cwd: process.cwd(),
  dotEnvPath,
  dotEnvExists: fs.existsSync(dotEnvPath),
  port: PORT,
})

createApp().then(app => {
  app.listen(PORT, API_HOST, () => {
    console.log(`[BloomAI Server] Running on http://${API_HOST}:${PORT}`)
  })
})

process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
