import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createFixtureServer } from './fixture-tools.mjs'

const server = createFixtureServer()
const transport = new StdioServerTransport()

process.once('SIGTERM', async () => {
  await server.close()
  process.exit(0)
})
process.once('SIGINT', async () => {
  await server.close()
  process.exit(0)
})

await server.connect(transport)
