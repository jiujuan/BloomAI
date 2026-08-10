import { createHash } from 'node:crypto'
import { McpError } from './errors'
import { hashMcpTransportConfig } from './transport-policy'
import type {
  DiscoveredMcpTool,
  McpServerConnectionConfig,
  McpTransportConfig,
} from './types'
import { McpSecurityError } from './types'
import type {
  McpConnectionMode,
  McpConnectOptions,
  McpExecuteOptions,
  McpProviderAdapter,
  McpProviderConnection,
} from './provider'

const DEFAULT_MODE: McpConnectionMode = 'cached'

type ManagedConnectionState = {
  readonly serverId: string
  readonly fingerprint: string
  readonly raw: McpProviderConnection
  active: boolean
  disconnectPromise?: Promise<void>
  wrapper: ManagedMcpProviderConnection
}

type CachedConnectionEntry = {
  readonly serverId: string
  readonly fingerprint: string
  readonly state: ManagedConnectionState
  tools?: DiscoveredMcpTool[]
  discoveryPromise?: Promise<DiscoveredMcpTool[]>
}

type PendingCreate = {
  readonly serverId: string
  readonly fingerprint: string
  readonly config: McpServerConnectionConfig
  readonly createController: AbortController
  active: boolean
  promise?: Promise<ManagedMcpProviderConnection>
}

/**
 * Owns the lifecycle of provider connections without exposing provider-specific
 * objects to application code. Cached connections are keyed by server identity
 * and a non-secret configuration fingerprint; temporary connections are always
 * disposed after the manager operation that created them completes.
 */
export class McpConnectionManager {
  private readonly adapter: McpProviderAdapter
  private readonly defaultTimeoutMs?: number
  private readonly cachedConnections = new Map<string, CachedConnectionEntry>()
  private readonly pendingCreates = new Map<string, PendingCreate>()
  private readonly liveStates = new Set<ManagedConnectionState>()
  private disconnectAllPromise?: Promise<void>

  constructor(options: { adapter: McpProviderAdapter; defaultTimeoutMs?: number }) {
    this.adapter = options.adapter
    this.defaultTimeoutMs = validateTimeout(options.defaultTimeoutMs)
  }

  async connect(
    config: McpServerConnectionConfig,
    options: McpConnectOptions = {},
  ): Promise<McpProviderConnection> {
    if (this.disconnectAllPromise) await this.disconnectAllPromise
    const mode = validateMode(options.mode)
    const fingerprint = createConnectionFingerprint(config)
    throwIfAborted(options.signal)

    if (mode === 'temporary') {
      return this.createTemporary(config, fingerprint, options.signal)
    }
    return this.connectCached(config, fingerprint, options.signal)
  }

  async listTools(
    config: McpServerConnectionConfig,
    options: McpConnectOptions = {},
  ): Promise<DiscoveredMcpTool[]> {
    const mode = validateMode(options.mode)
    if (mode === 'temporary') {
      const connection = await this.connect(config, options)
      const state = getManagedState(connection)
      try {
        return await this.discoverTools(state, options.signal)
      } finally {
        await this.disposeState(state, true)
      }
    }

    const connection = await this.connect(config, options)
    const state = getManagedState(connection)
    return this.discoverTools(state, options.signal)
  }

  async executeTool(
    config: McpServerConnectionConfig,
    remoteName: string,
    input: unknown,
    options: McpExecuteOptions = {},
  ): Promise<unknown> {
    const timeoutMs = resolveTimeout(options.timeoutMs, this.defaultTimeoutMs)
    const mode = validateMode(options.mode)
    const operation = createOperationSignal(options.signal, timeoutMs)
    let state: ManagedConnectionState | undefined

    try {
      const connection = await this.connect(config, {
        mode,
        signal: operation.controller.signal,
      })
      state = getManagedState(connection)
      if (operation.controller.signal.aborted) {
        throw operationAbortError(operation.reason())
      }

      const execution = Promise.resolve().then(() => (
        connection.executeTool(remoteName, input, operation.controller.signal)
      ))
      try {
        return await awaitWithAbort(execution, operation.controller.signal, operation.reason)
      } catch (error) {
        if (operation.controller.signal.aborted) throw operationAbortError(operation.reason())
        throw error
      }
    } catch (error) {
      const operationError = operation.reason()
      if (operationError !== undefined) {
        await this.disposeState(state, true)
        throw operationAbortError(operationError)
      }

      const mapped = mapToolError(error)
      if (state && isConnectionFailure(mapped)) await this.disposeState(state, true)
      throw mapped
    } finally {
      operation.dispose()
      if (mode === 'temporary' && state) await this.disposeState(state, true)
    }
  }

  async reconnect(
    config: McpServerConnectionConfig,
    options: Pick<McpConnectOptions, 'signal'> = {},
  ): Promise<McpProviderConnection> {
    if (this.disconnectAllPromise) await this.disconnectAllPromise
    const serverId = getServerId(config)
    await this.invalidateServer(serverId)
    return this.connect(config, { mode: 'cached', signal: options.signal })
  }

  async disconnectAll(): Promise<void> {
    if (this.disconnectAllPromise) return this.disconnectAllPromise

    const promise = this.performDisconnectAll()
    this.disconnectAllPromise = promise
    try {
      await promise
    } finally {
      if (this.disconnectAllPromise === promise) this.disconnectAllPromise = undefined
    }
  }

  /** @internal Used by managed provider wrappers. */
  async disconnectManaged(state: ManagedConnectionState): Promise<void> {
    return this.disposeState(state, false)
  }

  private async connectCached(
    config: McpServerConnectionConfig,
    fingerprint: string,
    signal?: AbortSignal,
  ): Promise<McpProviderConnection> {
    const serverId = getServerId(config)
    const cached = this.cachedConnections.get(serverId)
    if (cached && cached.fingerprint === fingerprint && cached.state.active) {
      return cached.state.wrapper
    }
    if (cached) await this.disposeState(cached.state, true)

    const pending = this.pendingCreates.get(serverId)
    if (pending && pending.fingerprint === fingerprint && pending.active && pending.promise) {
      return await this.awaitCreate(pending, signal)
    }
    if (pending) this.invalidatePending(pending)

    const record: PendingCreate = {
      serverId,
      fingerprint,
      config,
      createController: new AbortController(),
      active: true,
    }
    const promise = this.createCached(record)
    record.promise = promise
    this.pendingCreates.set(serverId, record)

    try {
      return await this.awaitCreate(record, signal)
    } finally {
      if (this.pendingCreates.get(serverId) === record) this.pendingCreates.delete(serverId)
    }
  }

  private async awaitCreate(
    pending: PendingCreate,
    signal?: AbortSignal,
  ): Promise<McpProviderConnection> {
    if (!pending.promise) throw new McpError('MCP_CONNECTION_FAILED')
    try {
      return await awaitWithAbort(pending.promise, signal)
    } catch (error) {
      if (signal?.aborted) {
        this.invalidatePending(pending)
        const cached = this.cachedConnections.get(pending.serverId)
        if (cached?.fingerprint === pending.fingerprint) await this.disposeState(cached.state, true)
        if (pending.promise) {
          const settled = pending.promise.catch(() => undefined)
          await Promise.race([settled, nextTurn()])
        }
        throw new McpError('MCP_TOOL_CANCELLED')
      }
      throw mapConnectionError(error)
    }
  }

  private async createCached(record: PendingCreate): Promise<ManagedMcpProviderConnection> {
    let raw: McpProviderConnection | undefined
    let managed = false
    try {
      raw = await this.adapter.createConnection(record.config, record.createController.signal)
      if (!isProviderConnection(raw)) throw new Error('invalid provider connection')

      const state = this.createManagedState(record.serverId, record.fingerprint, raw)
      managed = true
      if (!record.active || this.pendingCreates.get(record.serverId)?.fingerprint !== record.fingerprint) {
        await this.disposeState(state, true)
        throw new McpError('MCP_CONNECTION_FAILED')
      }

      this.cachedConnections.set(record.serverId, {
        serverId: record.serverId,
        fingerprint: record.fingerprint,
        state,
      })
      return state.wrapper
    } catch (error) {
      if (raw && !managed) await safeDisconnect(raw)
      if (!record.active) throw new McpError('MCP_CONNECTION_FAILED')
      throw mapConnectionError(error)
    }
  }

  private async createTemporary(
    config: McpServerConnectionConfig,
    fingerprint: string,
    signal?: AbortSignal,
  ): Promise<McpProviderConnection> {
    throwIfAborted(signal)
    let raw: McpProviderConnection | undefined
    let managed = false
    try {
      raw = await this.adapter.createConnection(config, signal)
      if (!isProviderConnection(raw)) throw new Error('invalid provider connection')
      const state = this.createManagedState(getServerId(config), fingerprint, raw)
      managed = true
      if (signal?.aborted) {
        await this.disposeState(state, true)
        throw new McpError('MCP_TOOL_CANCELLED')
      }
      return state.wrapper
    } catch (error) {
      if (raw && !managed) await safeDisconnect(raw)
      if (signal?.aborted) throw new McpError('MCP_TOOL_CANCELLED')
      throw mapConnectionError(error)
    }
  }

  private createManagedState(
    serverId: string,
    fingerprint: string,
    raw: McpProviderConnection,
  ): ManagedConnectionState {
    const state = {
      serverId,
      fingerprint,
      raw,
      active: true,
    } as ManagedConnectionState
    state.wrapper = new ManagedMcpProviderConnection(this, state)
    this.liveStates.add(state)
    return state
  }

  private async discoverTools(
    state: ManagedConnectionState,
    signal?: AbortSignal,
  ): Promise<DiscoveredMcpTool[]> {
    assertActive(state)
    const entry = this.cachedConnections.get(state.serverId)
    if (entry?.state === state && entry.tools) {
      throwIfAborted(signal)
      return [...entry.tools]
    }

    if (entry?.state === state && entry.discoveryPromise) {
      return [...await awaitWithAbort(entry.discoveryPromise, signal)]
    }

    const discoveryPromise = Promise.resolve()
      .then(() => {
        assertActive(state)
        return state.raw.listTools()
      })
      .then((tools) => {
        if (!Array.isArray(tools)) throw new McpError('MCP_PROTOCOL_ERROR')
        const normalized = [...tools]
        const current = this.cachedConnections.get(state.serverId)
        if (current?.state === state) current.tools = normalized
        return normalized
      })
      .catch((error) => {
        const mapped = mapDiscoveryError(error)
        if (isConnectionFailure(mapped)) void this.disposeState(state, true)
        throw mapped
      })

    if (entry?.state === state) entry.discoveryPromise = discoveryPromise
    return [...await awaitWithAbort(discoveryPromise, signal)]
  }

  private async invalidateServer(serverId: string): Promise<void> {
    const cached = this.cachedConnections.get(serverId)
    if (cached) await this.disposeState(cached.state, true)
    const pending = this.pendingCreates.get(serverId)
    if (pending) this.invalidatePending(pending)
  }

  private invalidatePending(pending: PendingCreate): void {
    if (!pending.active) return
    pending.active = false
    if (this.pendingCreates.get(pending.serverId) === pending) this.pendingCreates.delete(pending.serverId)
    pending.createController.abort()
  }

  private async disposeState(state: ManagedConnectionState | undefined, swallow: boolean): Promise<void> {
    if (!state) return
    state.active = false

    const cached = this.cachedConnections.get(state.serverId)
    if (cached?.state === state) this.cachedConnections.delete(state.serverId)

    if (!state.disconnectPromise) {
      state.disconnectPromise = Promise.resolve()
        .then(() => state.raw.disconnect())
        .then(() => undefined)
        .catch((error) => {
          throw mapConnectionError(error)
        })
        .finally(() => {
          this.liveStates.delete(state)
        })
    }

    if (swallow) {
      await state.disconnectPromise.catch(() => undefined)
      return
    }
    await state.disconnectPromise
  }

  private async performDisconnectAll(): Promise<void> {
    const pending = [...this.pendingCreates.values()]
    for (const record of pending) this.invalidatePending(record)
    this.cachedConnections.clear()
    for (const state of this.liveStates) state.active = false

    await Promise.allSettled(pending.map((record) => record.promise ?? Promise.resolve()))
    await Promise.allSettled([...this.liveStates].map((state) => this.disposeState(state, true)))
    this.cachedConnections.clear()
  }
}

class ManagedMcpProviderConnection implements McpProviderConnection {
  constructor(
    private readonly manager: McpConnectionManager,
    private readonly state: ManagedConnectionState,
  ) {}

  async listTools(signal?: AbortSignal): Promise<DiscoveredMcpTool[]> {
    assertActive(this.state)
    return this.state.raw.listTools(signal)
  }

  async executeTool(remoteName: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
    assertActive(this.state)
    return this.state.raw.executeTool(remoteName, input, signal)
  }

  disconnect(): Promise<void> {
    return this.manager.disconnectManaged(this.state)
  }

  get managedState(): ManagedConnectionState {
    return this.state
  }
}

function getManagedState(connection: McpProviderConnection): ManagedConnectionState {
  if (connection instanceof ManagedMcpProviderConnection) return connection.managedState
  throw new McpError('MCP_CONNECTION_FAILED')
}

function createConnectionFingerprint(config: McpServerConnectionConfig): string {
  if (!isRecord(config)
    || typeof config.serverId !== 'string'
    || !config.serverId
    || typeof config.name !== 'string'
    || !config.name
    || typeof config.configVersion !== 'string'
    || !config.configVersion
    || !isTransportConfig(config.transport)) {
    throw new McpSecurityError('MCP_CONFIG_INVALID')
  }

  const canonical = {
    serverId: config.serverId,
    name: config.name,
    configVersion: config.configVersion,
    isEnabled: config.isEnabled === true,
    trustLevel: config.trustLevel ?? 'untrusted',
    secretRefs: [...new Set(config.secretRefs ?? [])].sort(),
    transport: hashMcpTransportConfig(config.transport),
  }
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex')
}

function isTransportConfig(value: unknown): value is McpTransportConfig {
  return isRecord(value) && (value.kind === 'stdio' || value.kind === 'streamable_http')
}

function getServerId(config: McpServerConnectionConfig): string {
  if (!isRecord(config) || typeof config.serverId !== 'string' || !config.serverId) {
    throw new McpSecurityError('MCP_CONFIG_INVALID')
  }
  return config.serverId
}

function validateMode(mode: McpConnectionMode | undefined): McpConnectionMode {
  if (mode === undefined) return DEFAULT_MODE
  if (mode === 'cached' || mode === 'temporary') return mode
  throw new McpSecurityError('MCP_CONFIG_INVALID')
}

function validateTimeout(timeoutMs: number | undefined): number | undefined {
  if (timeoutMs === undefined) return undefined
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new McpSecurityError('MCP_CONFIG_INVALID')
  }
  return timeoutMs
}

function resolveTimeout(explicit: number | undefined, fallback: number | undefined): number | undefined {
  return validateTimeout(explicit === undefined ? fallback : explicit)
}

function createOperationSignal(external: AbortSignal | undefined, timeoutMs: number | undefined): {
  controller: AbortController
  reason: () => 'timeout' | 'cancelled' | undefined
  dispose: () => void
} {
  const controller = new AbortController()
  let operationReason: 'timeout' | 'cancelled' | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const abortCancelled = () => {
    if (operationReason === undefined) operationReason = 'cancelled'
    controller.abort()
  }
  const onExternalAbort = () => abortCancelled()

  if (external?.aborted) abortCancelled()
  else external?.addEventListener('abort', onExternalAbort, { once: true })

  if (timeoutMs !== undefined) {
    timer = setTimeout(() => {
      if (operationReason === undefined) operationReason = 'timeout'
      controller.abort()
    }, timeoutMs)
  }

  return {
    controller,
    reason: () => operationReason,
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer)
      external?.removeEventListener('abort', onExternalAbort)
    },
  }
}

function operationAbortError(reason: 'timeout' | 'cancelled' | undefined): McpError {
  return new McpError(reason === 'timeout' ? 'MCP_TOOL_TIMEOUT' : 'MCP_TOOL_CANCELLED')
}

async function awaitWithAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  reason?: () => 'timeout' | 'cancelled' | undefined,
): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) throw operationAbortError(reason?.())

  let onAbort: (() => void) | undefined
  const abort = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(operationAbortError(reason?.()))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([promise, abort])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
    void promise.catch(() => undefined)
  }
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new McpError('MCP_TOOL_CANCELLED')
}

function assertActive(state: ManagedConnectionState): void {
  if (!state.active) throw new McpError('MCP_CONNECTION_FAILED')
}

function mapConnectionError(error: unknown): McpError | McpSecurityError {
  if (error instanceof McpError || error instanceof McpSecurityError) return error
  if (isKnownMcpError(error)) return new McpError(error.code)
  return new McpError('MCP_CONNECTION_FAILED')
}

function mapDiscoveryError(error: unknown): McpError | McpSecurityError {
  if (error instanceof McpError || error instanceof McpSecurityError) return error
  if (isKnownMcpError(error)) return new McpError(error.code)
  return new McpError('MCP_CONNECTION_FAILED')
}

function mapToolError(error: unknown): McpError | McpSecurityError {
  if (error instanceof McpError || error instanceof McpSecurityError) return error
  if (isKnownMcpError(error)) return new McpError(error.code)
  if (isAbortLike(error)) return new McpError('MCP_TOOL_CANCELLED')
  return new McpError('MCP_TOOL_ERROR')
}

function isConnectionFailure(error: McpError | McpSecurityError): boolean {
  return error.code === 'MCP_CONNECTION_FAILED' || error.code === 'MCP_PROTOCOL_ERROR'
}

function isKnownMcpError(value: unknown): value is { code: McpError['code'] } {
  return isRecord(value)
    && typeof value.code === 'string'
    && [
      'MCP_DISABLED',
      'MCP_CONFIG_INVALID',
      'MCP_SERVER_NOT_FOUND',
      'MCP_TOOL_NOT_FOUND',
      'MCP_SERVER_DISABLED',
      'MCP_TOOL_DISABLED',
      'MCP_ROLE_NOT_ALLOWED',
      'MCP_APPROVAL_REQUIRED',
      'MCP_APPROVAL_INVALID',
      'MCP_APPROVAL_EXPIRED',
      'MCP_PREVIEW_STALE',
      'MCP_SCHEMA_UNSUPPORTED',
      'MCP_CONNECTION_FAILED',
      'MCP_PROTOCOL_ERROR',
      'MCP_TOOL_ERROR',
      'MCP_TOOL_TIMEOUT',
      'MCP_TOOL_CANCELLED',
    ].includes(value.code)
}

function isProviderConnection(value: unknown): value is McpProviderConnection {
  return isRecord(value)
    && typeof value.listTools === 'function'
    && typeof value.executeTool === 'function'
    && typeof value.disconnect === 'function'
}

function isAbortLike(error: unknown): boolean {
  return isRecord(error) && (error.name === 'AbortError' || error.code === 'ABORT_ERR')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function safeDisconnect(connection: McpProviderConnection): Promise<void> {
  try {
    await connection.disconnect()
  } catch {
    // Cleanup must never make the host process fail or expose provider details.
  }
}