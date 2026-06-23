import { createApp } from './app'
import { API_HOST, BLOOMAI_PORT_ENV, DEFAULT_SERVER_PORT } from '../shared/constants'

const PORT = parseInt(process.env[BLOOMAI_PORT_ENV] || String(DEFAULT_SERVER_PORT), 10)

createApp().then(app => {
  app.listen(PORT, API_HOST, () => {
    console.log(`[BloomAI Server] Running on http://${API_HOST}:${PORT}`)
  })
})

process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
