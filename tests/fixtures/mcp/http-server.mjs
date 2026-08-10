import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createFixtureServer } from './fixture-tools.mjs'

const port = Number(process.argv[2] || 0)
const traceFile = process.env.MCP_FIXTURE_TRACE_FILE
const sessions = new Map()

async function trace(event) {
  if (!traceFile) return
  let events = []
  try {
    events = JSON.parse(await readFile(traceFile, 'utf8'))
  } catch {
    events = []
  }
  events.push(event)
  await writeFile(traceFile, JSON.stringify(events), 'utf8')
}

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  if (chunks.length === 0) return undefined
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function createSession() {
  let sessionId
  const server = createFixtureServer()
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (id) => {
      sessionId = id
      sessions.set(id, { server, transport })
    },
    onsessionclosed: (id) => {
      sessions.delete(id)
    },
  })
  transport.onclose = () => {
    if (sessionId) sessions.delete(sessionId)
  }
  await server.connect(transport)
  return { server, transport }
}

const httpServer = createServer(async (request, response) => {
  const requestPath = new URL(request.url || '/', 'http://127.0.0.1').pathname
  const sessionId = request.headers['mcp-session-id']
  await trace({
    method: request.method,
    path: requestPath,
    accept: request.headers.accept || null,
    contentType: request.headers['content-type'] || null,
    sessionId: typeof sessionId === 'string' ? sessionId : null,
  })

  if (requestPath === '/__health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true }))
    return
  }

  if (requestPath !== '/mcp') {
    response.writeHead(404)
    response.end()
    return
  }

  try {
    let session = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined
    if (request.method === 'POST' && !session) {
      session = await createSession()
    }

    if (!session) {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'unknown MCP session' }))
      return
    }

    const body = request.method === 'POST' ? await readBody(request) : undefined
    await session.transport.handleRequest(request, response, body)
  } catch (error) {
    if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' })
    if (!response.writableEnded) response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  }
})

httpServer.on('error', (error) => {
  console.error(error)
  process.exitCode = 1
})

process.once('SIGTERM', async () => {
  await Promise.allSettled([...sessions.values()].map(async ({ server, transport }) => {
    await server.close()
    await transport.close()
  }))
  httpServer.close(() => process.exit(0))
})
process.once('SIGINT', async () => {
  await Promise.allSettled([...sessions.values()].map(async ({ server, transport }) => {
    await server.close()
    await transport.close()
  }))
  httpServer.close(() => process.exit(0))
})

httpServer.listen(port, '127.0.0.1', () => {
  const address = httpServer.address()
  const actualPort = typeof address === 'object' && address ? address.port : port
  console.log(`READY ${actualPort}`)
})
