import { createApp } from './app'

const PORT = parseInt(process.env.BLOOMAI_PORT || '3718', 10)

createApp().then(app => {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`[BloomAI Server] Running on http://127.0.0.1:${PORT}`)
  })
})

process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
