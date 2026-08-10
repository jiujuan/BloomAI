import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { Readable } from 'node:stream'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { MCPClient, type LogMessage, type MastraMCPServerDefinition } from '@mastra/mcp'

const require = createRequire(import.meta.url)
const repoRoot = process.cwd()
const fixtureRoot = path.resolve(repoRoot, 'tests/fixtures/mcp')
const stdioFixturePath = path.join(fixtureRoot, 'stdio-server.mjs')
const httpFixturePath = path.join(fixtureRoot, 'http-server.mjs')

type ToolContext = { abortSignal?: AbortSignal }
type FixtureChild = ChildProcessByStdio<null, Readable, Readable>
type McpLogEvent = Pick<LogMessage, 'level' | 'message'>

type MastraToolLike = {
  id: string
  description?: string
  inputSchema?: unknown
  outputSchema?: unknown
  execute(input: unknown, context?: ToolContext): Promise<unknown>
}

type DiscoveredMcpTool = {
  localName: string
  remoteName: string
  description?: string
  inputSchema?: unknown
  outputSchema?: unknown
  tool: MastraToolLike
}

export interface McpProviderConnection {
  listTools(signal?: AbortSignal): Promise<DiscoveredMcpTool[]>
  executeTool(remoteName: string, input: unknown, signal?: AbortSignal): Promise<unknown>
  disconnect(): Promise<void>
}

export interface McpSpikeReport {
  package: {
    node: string
    mastraCore: string
    mastraMcp: string
    mcpSdk: string
    peerDependency: string
    nodeEngine: string
  }
  api: {
    constructor: string
    listToolsReturn: string
    namespace: string
    lifecycle: string[]
    httpTransport: string
    sseFallback: string
  }
  stdio: TransportReport
  http: TransportReport & {
    trace: Array<Record<string, unknown>>
    sseFallbackDetected: boolean
    sseFallbackLogMessages: string[]
  }
  adapterContract: {
    methods: string[]
    executePath: string
    abortPath: string
  }
}

type TransportReport = {
  toolNames: string[]
  mappedRemoteNames: string[]
  toolIds: Record<string, string>
  hasInputSchema: Record<string, boolean>
  hasOutputSchema: Record<string, boolean>
  echoResult: unknown
  structuredResult: unknown
  errorResult: unknown
  largeResultLength: number
  abortElapsedMs: number
  timeoutElapsedMs: number
  recoveredAfterTimeout: unknown
  recoveredAfterReconnect: unknown
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`MCP spike assertion failed: ${message}`)
}

function packageVersion(packageName: string): { version: string; peerDependencies?: Record<string, string>; engines?: Record<string, string> } {
  let directory = path.dirname(require.resolve(`${packageName}/package.json`))
  while (true) {
    const manifestPath = path.join(directory, 'package.json')
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        name?: string
        version?: string
        peerDependencies?: Record<string, string>
        engines?: Record<string, string>
      }
      if (manifest.name === packageName && manifest.version) return manifest as {
        version: string
        peerDependencies?: Record<string, string>
        engines?: Record<string, string>
      }
    } catch {
      // Continue walking up for packages whose export maps resolve to a nested package.json.
    }
    const parent = path.dirname(directory)
    if (parent === directory) throw new Error(`Cannot locate package manifest for ${packageName}`)
    directory = parent
  }
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError')
}

function createMastraConnection(
  serverName: string,
  serverDefinition: MastraMCPServerDefinition,
  timeout: number,
  logEvents: McpLogEvent[] = [],
): McpProviderConnection & { reconnect(): Promise<void> } {
  const clientDefinition: MastraMCPServerDefinition = {
    ...serverDefinition,
    logger: (log: LogMessage) => {
      logEvents.push({ level: log.level, message: log.message })
    },
  }
  const client = new MCPClient({
    id: `mcp-spike-${serverName}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    servers: { [serverName]: clientDefinition },
    timeout,
  })
  let discovered: DiscoveredMcpTool[] | undefined

  const listTools = async (signal?: AbortSignal): Promise<DiscoveredMcpTool[]> => {
    if (signal?.aborted) throw abortError()
    const tools = (await client.listTools()) as Record<string, MastraToolLike>
    const prefix = `${serverName}_`
    discovered = Object.entries(tools).map(([localName, tool]) => {
      assert(localName.startsWith(prefix), `Mastra tool ${localName} must use ${prefix} namespace`)
      return {
        localName,
        remoteName: localName.slice(prefix.length),
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        tool,
      }
    })
    return discovered
  }

  return {
    listTools,
    async executeTool(remoteName, input, signal) {
      const tools = discovered || (await listTools(signal))
      const entry = tools.find((candidate) => candidate.remoteName === remoteName)
      if (!entry) throw new Error(`Unknown MCP fixture tool: ${remoteName}`)
      return entry.tool.execute(input, { abortSignal: signal })
    },
    async disconnect() {
      await client.disconnect()
    },
    async reconnect() {
      await client.reconnectServer(serverName)
      discovered = undefined
    },
  }
}

async function runTransportScenario(
  label: string,
  serverDefinition: MastraMCPServerDefinition,
  logEvents: McpLogEvent[] = [],
): Promise<TransportReport> {
  const connection = createMastraConnection(label, serverDefinition, 300, logEvents)
  try {
    const discovered = await connection.listTools()
    const toolNames = discovered.map((tool) => tool.localName).sort()
    const mappedRemoteNames = discovered.map((tool) => tool.remoteName).sort()
    const toolIds = Object.fromEntries(discovered.map((tool) => [tool.remoteName, tool.tool.id]))
    const hasInputSchema = Object.fromEntries(discovered.map((tool) => [tool.remoteName, Boolean(tool.inputSchema)]))
    const hasOutputSchema = Object.fromEntries(discovered.map((tool) => [tool.remoteName, Boolean(tool.outputSchema)]))

    assert(toolNames.includes(`${label}_echo`), 'echo must be discovered')
    assert(toolNames.includes(`${label}_structured`), 'structured must be discovered')
    assert(toolNames.includes(`${label}_error`), 'error must be discovered')
    assert(toolNames.includes(`${label}_delay`), 'delay must be discovered')
    assert(toolNames.includes(`${label}_large`), 'large must be discovered')
    assert(toolIds.echo === `${label}_echo`, 'Mastra Tool id must preserve the namespaced local name')
    assert(mappedRemoteNames.includes('echo'), 'remote echo name must be preserved separately from the local name')
    assert(mappedRemoteNames.includes('structured'), 'remote structured name must be preserved separately from the local name')

    const echoResult = await connection.executeTool('echo', { text: 'hello' })
    assert(
      typeof echoResult === 'object' && echoResult !== null && Array.isArray((echoResult as { content?: unknown }).content),
      'echo must expose the MCP content result',
    )

    const structuredResult = await connection.executeTool('structured', { value: 'abc' })
    assert(
      JSON.stringify(structuredResult) === JSON.stringify({ value: 'abc', length: 3 }),
      'structuredContent must be returned as the structured tool result',
    )

    const errorResult = await connection.executeTool('error', { message: 'fixture-error' })
    assert(
      typeof errorResult === 'object' && errorResult !== null && (errorResult as { isError?: unknown }).isError === true,
      'in-band MCP isError must remain observable when onToolError is return',
    )

    const largeResult = await connection.executeTool('large', { size: 4096 })
    const largeContent = (largeResult as { content?: Array<{ text?: string }> }).content?.[0]?.text
    assert(largeContent?.length === 4096, 'large fixture result must be delivered without transport truncation')

    const abortController = new AbortController()
    const abortStartedAt = Date.now()
    const abortPromise = connection.executeTool('delay', { ms: 5_000 }, abortController.signal)
    setTimeout(() => abortController.abort(), 50)
    let abortRejected = false
    try {
      await abortPromise
    } catch {
      abortRejected = true
    }
    const abortElapsedMs = Date.now() - abortStartedAt
    assert(abortRejected, 'AbortSignal must reject an in-flight tool call')
    assert(abortElapsedMs < 1_500, `AbortSignal must stop the call promptly; observed ${abortElapsedMs}ms`)

    const timeoutStartedAt = Date.now()
    let timeoutRejected = false
    try {
      await connection.executeTool('delay', { ms: 2_000 })
    } catch {
      timeoutRejected = true
    }
    const timeoutElapsedMs = Date.now() - timeoutStartedAt
    assert(timeoutRejected, 'configured MCP timeout must reject a delayed tool call')
    assert(timeoutElapsedMs < 1_500, `MCP timeout must be bounded; observed ${timeoutElapsedMs}ms`)

    await connection.reconnect()
    const recoveredAfterTimeout = await connection.executeTool('echo', { text: 'after-timeout' })
    assert(recoveredAfterTimeout !== undefined, 'client must recover after timeout through explicit reconnect')

    await connection.disconnect()
    await connection.reconnect()
    const recoveredAfterReconnect = await connection.executeTool('echo', { text: 'after-reconnect' })
    assert(recoveredAfterReconnect !== undefined, 'client must recover after disconnect/reconnect')

    return {
      toolNames,
      mappedRemoteNames,
      toolIds,
      hasInputSchema,
      hasOutputSchema,
      echoResult,
      structuredResult,
      errorResult,
      largeResultLength: largeContent?.length || 0,
      abortElapsedMs,
      timeoutElapsedMs,
      recoveredAfterTimeout,
      recoveredAfterReconnect,
    }
  } finally {
    await connection.disconnect().catch(() => undefined)
  }
}

function waitForReady(child: FixtureChild): Promise<number> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let settled = false
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        reject(new Error(`Timed out waiting for MCP fixture readiness. stdout=${stdout}`))
      }
    }, 5_000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      const match = stdout.match(/READY (\d+)/)
      if (match && !settled) {
        settled = true
        clearTimeout(timeout)
        resolve(Number(match[1]))
      }
    })
    child.once('error', (error) => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        reject(error)
      }
    })
    child.once('exit', (code, signal) => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        reject(new Error(`MCP HTTP fixture exited before readiness: code=${code} signal=${signal}`))
      }
    })
  })
}

async function stopChild(child: FixtureChild): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 2_000)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

async function readTrace(tracePath: string): Promise<Array<Record<string, unknown>>> {
  try {
    return JSON.parse(await readFile(tracePath, 'utf8'))
  } catch {
    return []
  }
}

export async function runMcpSpike(): Promise<McpSpikeReport> {
  const mastraMcp = packageVersion('@mastra/mcp')
  const mastraCore = packageVersion('@mastra/core')
  const sdk = packageVersion('@modelcontextprotocol/sdk')
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'bloomai-mcp-spike-'))
  const tracePath = path.join(tempRoot, 'http-trace.json')
  let httpChild: FixtureChild | undefined

  try {
    const stdio = await runTransportScenario('stdio', {
      command: process.execPath,
      args: [stdioFixturePath],
      env: {
        MCP_FIXTURE_MODE: 'stdio',
        MCP_FIXTURE_SYNTHETIC_TOKEN: 'test-mcp-token',
      },
      stderr: 'pipe',
      onToolError: 'return',
    })

    httpChild = spawn(process.execPath, [httpFixturePath, '0'], {
      cwd: repoRoot,
      env: {
        MCP_FIXTURE_TRACE_FILE: tracePath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const port = await waitForReady(httpChild)
    const httpLogs: McpLogEvent[] = []
    const http = await runTransportScenario('http', {
      url: new URL(`http://127.0.0.1:${port}/mcp`),
      connectTimeout: 1_000,
      onToolError: 'return',
    }, httpLogs)
    const trace = await readTrace(tracePath)
    const sseFallbackLogMessages = httpLogs
      .filter(({ message }) => message.includes('deprecated HTTP+SSE transport'))
      .map(({ message }) => message)
    const sseFallbackDetected =
      sseFallbackLogMessages.length > 0 ||
      trace.some((event) => String(event.method || '').toUpperCase() === 'GET' && event.sessionId == null)
    assert(trace.length > 0, 'HTTP fixture must record real MCP requests')
    assert(trace.some((event) => String(event.method || '').toUpperCase() === 'POST'), 'HTTP fixture must record POST requests')
    assert(trace.some((event) => String(event.method || '').toUpperCase() === 'POST' && event.sessionId), 'Streamable HTTP must establish a stateful session')
    assert(!sseFallbackDetected, 'Streamable HTTP spike must not silently fall back to legacy SSE')

    return {
      package: {
        node: process.version,
        mastraCore: mastraCore.version,
        mastraMcp: mastraMcp.version,
        mcpSdk: sdk.version,
        peerDependency: mastraMcp.peerDependencies?.['@mastra/core'] || 'unknown',
        nodeEngine: mastraMcp.engines?.node || 'unknown',
      },
      api: {
        constructor: 'new MCPClient({ id?, servers, timeout? })',
        listToolsReturn: 'Promise<Record<string, Mastra Tool>>',
        namespace: 'serverName_remoteName; the remote name is the suffix after the first namespace separator',
        lifecycle: ['listTools', 'disconnect', 'reconnectServer'],
        httpTransport: 'Streamable HTTP is attempted for URL endpoints and accepts a custom connectTimeout; this fixture used stateful StreamableHTTPServerTransport with JSON responses.',
        sseFallback: 'The package runtime can fall back after Streamable HTTP failure; the Spike fails closed when Mastra logs the deprecated HTTP+SSE fallback or when an unauthenticated legacy SSE GET is observed. The fixture completed without fallback.',
      },
      stdio,
      http: { ...http, trace, sseFallbackDetected, sseFallbackLogMessages },
      adapterContract: {
        methods: ['listTools(signal?)', 'executeTool(remoteName, input, signal?)', 'disconnect()'],
        executePath: 'MCPClient.listTools() -> namespaced Mastra Tool.execute(input, { abortSignal })',
        abortPath: 'AbortSignal -> Mastra Tool.execute context -> MCP SDK request signal',
      },
    }
  } finally {
    if (httpChild) await stopChild(httpChild)
    await rm(tempRoot, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMcpSpike()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2))
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.stack || error.message : error)
      process.exitCode = 1
    })
}
