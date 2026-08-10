import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import {
  StdioProcessRegistry,
  createTransportSecurityState,
  createHttpRequestOptions,
  createStdioSpawnOptions,
  hashMcpTransportConfig,
  installStdioProcessShutdownHandlers,
  isBlockedNetworkAddress,
  validateHttpRedirectTarget,
  validateHttpTransport,
  updateTransportSecurityState,
  validateStdioTransport,
} from '../transport-policy'
import { SecretResolver } from '../secret-resolver'
import { McpSecurityError } from '../types'

function publicLookup(hostname: string) {
  return Promise.resolve([{ address: hostname === 'public.example' ? '93.184.216.34' : '2001:4860:4860::8888', family: hostname === 'public.example' ? 4 : 6 }])
}

class FakeChild extends EventEmitter {
  readonly signals: string[] = []
  exited = false

  constructor(private readonly exitsGracefully: boolean) {
    super()
  }

  kill(signal: string = 'SIGTERM') {
    this.signals.push(signal)
    if (signal === 'SIGTERM' && this.exitsGracefully) {
      queueMicrotask(() => {
        this.exited = true
        this.emit('exit', 0, null)
      })
    }
    return true
  }
}

describe('MCP stdio transport policy', () => {
  it('normalizes structured stdio configuration and forces shell false', () => {
    expect(validateStdioTransport({
      kind: 'stdio',
      command: process.execPath,
      args: ['fixture.mjs', '--safe'],
      cwd: process.cwd(),
      env: { NODE_ENV: 'test' },
    })).toEqual({
      kind: 'stdio',
      command: process.execPath,
      args: ['fixture.mjs', '--safe'],
      cwd: process.cwd(),
      env: { NODE_ENV: 'test' },
      shell: false,
    })
  })

  it('rejects URLs, package installers, invalid cwd and control characters', () => {
    for (const command of ['https://evil.example/server.mjs', 'npx', 'npm', 'pnpm', 'yarn', 'bunx']) {
      expect(() => validateStdioTransport({ kind: 'stdio', command, args: [] }))
        .toThrowError(new McpSecurityError('MCP_CONFIG_INVALID'))
    }
    expect(() => validateStdioTransport({ kind: 'stdio', command: process.execPath, args: ['https://evil.example'] }))
      .toThrowError(new McpSecurityError('MCP_CONFIG_INVALID'))
    expect(() => validateStdioTransport({ kind: 'stdio', command: process.execPath, cwd: 'relative/path' }))
      .toThrowError(new McpSecurityError('MCP_CONFIG_INVALID'))
    expect(() => validateStdioTransport({ kind: 'stdio', command: `${process.execPath}\u0000` }))
      .toThrowError(new McpSecurityError('MCP_CONFIG_INVALID'))
  })

  it('builds a minimal environment and resolves secrets only at spawn time', () => {
    const secretEnv = {
      MCP_ALLOWED_ENV_NAMES: 'MCP_TOKEN',
      MCP_TOKEN: 'spawn-only-secret',
      PATH: 'safe-path',
      UNSAFE_INHERITED: 'must-not-inherit',
    }
    const resolver = new SecretResolver({ env: secretEnv })
    const result = createStdioSpawnOptions({
      kind: 'stdio',
      command: process.execPath,
      args: ['fixture.mjs'],
      env: { MCP_TOKEN: '${env:MCP_TOKEN}', STATIC: 'safe-static' },
    }, { processEnv: secretEnv, secretResolver: resolver })

    expect(result.options).toMatchObject({ shell: false })
    expect(result.options.env).toEqual({
      PATH: 'safe-path',
      MCP_TOKEN: secretEnv.MCP_TOKEN,
      STATIC: 'safe-static',
    })
    expect(result.options.env).not.toHaveProperty('UNSAFE_INHERITED')
    expect(JSON.stringify(result)).toContain(secretEnv.MCP_TOKEN)
  })

  it('terminates tracked children on disconnect and escalates when graceful shutdown stalls', async () => {
    const graceful = new FakeChild(true)
    const stalled = new FakeChild(false)
    const registry = new StdioProcessRegistry({ gracePeriodMs: 1 })
    registry.track(graceful)
    registry.track(stalled)

    await registry.terminateAll()

    expect(graceful.signals).toEqual(['SIGTERM'])
    expect(stalled.signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(registry.size).toBe(0)
  })

  it('resets trust and enablement when command, args, cwd, or env references change', () => {
    const baseConfig = {
      kind: 'stdio' as const,
      command: process.execPath,
      args: ['fixture.mjs'],
      cwd: process.cwd(),
      env: { STATIC: 'safe-static', MCP_TOKEN: '${env:MCP_TOKEN}' },
    }
    const initial = createTransportSecurityState(baseConfig)
    expect(initial).toMatchObject({
      configFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      trustLevel: 'untrusted',
      isEnabled: false,
    })
    expect(hashMcpTransportConfig(baseConfig)).not.toContain('spawn-only-secret')

    const trusted = { ...initial, trustLevel: 'trusted' as const, isEnabled: true }
    const equivalent = updateTransportSecurityState(trusted, {
      ...baseConfig,
      env: { MCP_TOKEN: '${env:MCP_TOKEN}', STATIC: 'safe-static' },
    })
    expect(equivalent).toEqual(trusted)

    const changedConfigs = [
      { ...baseConfig, command: `${process.execPath}-changed` },
      { ...baseConfig, args: ['fixture.mjs', '--changed'] },
      { ...baseConfig, cwd: `${process.cwd()}\\changed` },
      { ...baseConfig, env: { ...baseConfig.env, MCP_TOKEN: '${env:OTHER_TOKEN}' } },
    ]
    for (const config of changedConfigs) {
      expect(updateTransportSecurityState(trusted, config)).toEqual({
        configFingerprint: hashMcpTransportConfig(config),
        trustLevel: 'untrusted',
        isEnabled: false,
      })
    }
  })

  it('installs removable application shutdown handlers for tracked stdio processes', async () => {
    const host = new EventEmitter()
    const registry = new StdioProcessRegistry({ gracePeriodMs: 1 })
    const child = new FakeChild(true)
    registry.track(child)

    const uninstall = installStdioProcessShutdownHandlers(registry, host as never)
    host.emit('SIGTERM')
    await new Promise((resolve) => setImmediate(resolve))
    expect(child.signals).toEqual(['SIGTERM'])

    uninstall()
    const secondChild = new FakeChild(true)
    registry.track(secondChild)
    host.emit('SIGINT')
    await new Promise((resolve) => setImmediate(resolve))
    expect(secondChild.signals).toEqual([])
    await registry.terminateAll()
  })
})

describe('MCP Streamable HTTP and SSRF policy', () => {
  it('does not trust localhost when DNS resolves outside the loopback range', async () => {
    await expect(validateHttpTransport({ kind: 'streamable_http', url: 'http://localhost:8787/mcp' }, {
      environment: 'development',
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    })).rejects.toThrowError(new McpSecurityError('MCP_CONFIG_INVALID'))
  })

  it('rejects malformed DNS answers instead of treating them as public', async () => {
    await expect(validateHttpTransport({ kind: 'streamable_http', url: 'https://public.example/mcp' }, {
      environment: 'production',
      lookup: async () => [{ address: 'not-an-ip-address', family: 4 }],
    })).rejects.toThrowError(new McpSecurityError('MCP_CONFIG_INVALID'))
  })

  it('requires HTTPS in production and allows only local HTTP in development', async () => {
    await expect(validateHttpTransport({ kind: 'streamable_http', url: 'http://public.example/mcp' }, {
      environment: 'production',
      lookup: publicLookup,
    })).rejects.toThrowError(new McpSecurityError('MCP_CONFIG_INVALID'))

    await expect(validateHttpTransport({ kind: 'streamable_http', url: 'http://public.example/mcp' }, {
      environment: 'development',
      lookup: publicLookup,
    })).rejects.toThrowError(new McpSecurityError('MCP_CONFIG_INVALID'))

    await expect(validateHttpTransport({ kind: 'streamable_http', url: 'http://localhost:8787/mcp' }, {
      environment: 'development',
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    })).resolves.toMatchObject({ url: new URL('http://localhost:8787/mcp') })
  })

  it('blocks private, link-local, metadata, and DNS-resolved internal addresses', async () => {
    for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '::1', 'fd00::1', 'fe80::1']) {
      expect(isBlockedNetworkAddress(address)).toBe(true)
    }
    expect(isBlockedNetworkAddress('93.184.216.34')).toBe(false)

    await expect(validateHttpTransport({ kind: 'streamable_http', url: 'https://10.0.0.1/mcp' }, {
      environment: 'production',
    })).rejects.toThrowError(new McpSecurityError('MCP_CONFIG_INVALID'))
    await expect(validateHttpTransport({ kind: 'streamable_http', url: 'https://internal.example/mcp' }, {
      environment: 'production',
      lookup: async () => [{ address: '192.168.1.42', family: 4 }],
    })).rejects.toThrowError(new McpSecurityError('MCP_CONFIG_INVALID'))
  })

  it('revalidates redirect targets instead of trusting the original URL', async () => {
    await expect(validateHttpRedirectTarget(
      new URL('https://public.example/mcp'),
      'https://169.254.169.254/latest',
      { environment: 'production', lookup: publicLookup },
    )).rejects.toThrowError(new McpSecurityError('MCP_CONFIG_INVALID'))
  })

  it('only accepts allowlisted secret references for headers and resolves them ephemerally', async () => {
    const env = { MCP_ALLOWED_ENV_NAMES: 'MCP_TOKEN', MCP_TOKEN: 'header-secret' }
    const resolver = new SecretResolver({ env })
    const config = {
      kind: 'streamable_http' as const,
      url: 'https://public.example/mcp',
      headers: { Authorization: '${env:MCP_TOKEN}' },
    }
    await expect(validateHttpTransport(config, { environment: 'production', lookup: publicLookup, secretResolver: resolver }))
      .resolves.toMatchObject({ headers: config.headers })
    await expect(createHttpRequestOptions(config, { environment: 'production', lookup: publicLookup, secretResolver: resolver }))
      .resolves.toMatchObject({ headers: { Authorization: env.MCP_TOKEN }, redirect: 'manual' })
    await expect(validateHttpTransport({ ...config, headers: { Authorization: 'Bearer literal-secret' } }, {
      environment: 'production', lookup: publicLookup, secretResolver: resolver,
    })).rejects.toThrowError(new McpSecurityError('MCP_CONFIG_INVALID'))
  })
})
