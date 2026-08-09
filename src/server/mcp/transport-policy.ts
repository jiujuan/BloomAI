import { createHash } from 'node:crypto'
import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { isAbsolute } from 'node:path'
import { createSecretResolver, parseSecretReference, type SecretResolver } from './secret-resolver'
import type {
  McpStdioTransportConfig,
  McpStreamableHttpTransportConfig,
  McpTransportConfig,
} from './types'
import { McpSecurityError } from './types'
import type { McpTransportSecurityState } from './types'

export type McpHttpEnvironment = 'production' | 'development' | 'test'

export type DnsLookup = (hostname: string) => Promise<ReadonlyArray<{ address: string; family: number }>>

export type HttpTransportPolicyOptions = {
  environment?: McpHttpEnvironment
  lookup?: DnsLookup
  secretResolver?: SecretResolver
}

export type ValidatedStdioTransport = {
  kind: 'stdio'
  command: string
  args: string[]
  cwd?: string
  env: Record<string, string>
  shell: false
}

export type StdioSpawnOptions = {
  command: string
  args: string[]
  options: {
    cwd?: string
    env: Record<string, string>
    shell: false
  }
}

export type ValidatedHttpTransport = {
  kind: 'streamable_http'
  url: URL
  headers: Record<string, string>
}

export type HttpRequestOptions = {
  url: URL
  headers: Record<string, string>
  redirect: 'manual'
}

export type StdioSpawnEnvironmentOptions = {
  processEnv?: Readonly<Record<string, string | undefined>>
  secretResolver?: SecretResolver
  inheritEnvNames?: readonly string[]
}

const DEFAULT_INHERITED_ENV_NAMES = [
  'PATH',
  'Path',
  'SystemRoot',
  'WINDIR',
  'HOME',
  'USERPROFILE',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
] as const
const PACKAGE_INSTALL_COMMANDS = new Set(['npx', 'npm', 'pnpm', 'yarn', 'bunx', 'corepack'])
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const URL_ARGUMENT_PATTERN = /^(?:https?|file|ftp):\/\//i
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const BLOCKED_HOSTNAMES = new Set([
  '169.254.169.254',
  'metadata',
  'metadata.google.internal',
  'instance-data',
])

export function hashMcpTransportConfig(config: McpTransportConfig): string {
  const canonical = canonicalizeTransportConfig(config)
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex')
}

export function createTransportSecurityState(config: McpTransportConfig): McpTransportSecurityState {
  return {
    configFingerprint: hashMcpTransportConfig(config),
    trustLevel: 'untrusted',
    isEnabled: false,
  }
}

export function updateTransportSecurityState(
  previous: McpTransportSecurityState,
  config: McpTransportConfig,
): McpTransportSecurityState {
  const configFingerprint = hashMcpTransportConfig(config)
  if (previous.configFingerprint === configFingerprint) return previous
  return {
    configFingerprint,
    trustLevel: 'untrusted',
    isEnabled: false,
  }
}

export function validateStdioTransport(config: McpStdioTransportConfig): ValidatedStdioTransport {
  if (!config || config.kind !== 'stdio') throw new McpSecurityError('MCP_CONFIG_INVALID')
  assertSafeText(config.command)
  if (!config.command.trim() || isUrlLikeCommand(config.command) || isPackageInstaller(config.command)) {
    throw new McpSecurityError('MCP_CONFIG_INVALID')
  }

  const args = [...(config.args ?? [])]
  for (const arg of args) {
    assertSafeText(arg)
    if (URL_ARGUMENT_PATTERN.test(arg)) throw new McpSecurityError('MCP_CONFIG_INVALID')
    if (arg.includes('${') && !parseSecretReference(arg)) throw new McpSecurityError('MCP_CONFIG_INVALID')
  }

  if (config.cwd !== undefined) {
    assertSafeText(config.cwd)
    if (!isAbsolute(config.cwd)) throw new McpSecurityError('MCP_CONFIG_INVALID')
  }

  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(config.env ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof value !== 'string') {
      throw new McpSecurityError('MCP_CONFIG_INVALID')
    }
    assertSafeText(value)
    if (value.includes('${') && !parseSecretReference(value)) throw new McpSecurityError('MCP_CONFIG_INVALID')
    env[name] = value
  }

  return {
    kind: 'stdio',
    command: config.command,
    args,
    ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
    env,
    shell: false,
  }
}

export function createStdioSpawnOptions(
  config: McpStdioTransportConfig,
  options: StdioSpawnEnvironmentOptions = {},
): StdioSpawnOptions {
  const validated = validateStdioTransport(config)
  const processEnv = options.processEnv ?? process.env
  const inheritedNames = options.inheritEnvNames ?? DEFAULT_INHERITED_ENV_NAMES
  const inherited: Record<string, string> = {}
  for (const name of inheritedNames) {
    const value = processEnv[name]
    if (value !== undefined) inherited[name] = value
  }

  const secretResolver = options.secretResolver ?? createSecretResolver({ env: processEnv })
  const resolvedEnv = secretResolver.resolveReferences(validated.env)

  return {
    command: validated.command,
    args: validated.args,
    options: {
      ...(validated.cwd === undefined ? {} : { cwd: validated.cwd }),
      env: { ...inherited, ...resolvedEnv },
      shell: false,
    },
  }
}

export async function validateHttpTransport(
  config: McpStreamableHttpTransportConfig,
  options: HttpTransportPolicyOptions = {},
): Promise<ValidatedHttpTransport> {
  if (!config || config.kind !== 'streamable_http') throw new McpSecurityError('MCP_CONFIG_INVALID')
  const url = normalizeHttpUrl(config.url)
  const environment = getEnvironment(options.environment)
  if (environment === 'production' && url.protocol !== 'https:') {
    throw new McpSecurityError('MCP_CONFIG_INVALID')
  }
  if (url.protocol === 'http:' && !isLocalDevelopmentHost(url.hostname)) {
    throw new McpSecurityError('MCP_CONFIG_INVALID')
  }
  if (environment === 'production' && isLocalDevelopmentHost(url.hostname)) {
    throw new McpSecurityError('MCP_CONFIG_INVALID')
  }

  await assertSafeHttpHost(url.hostname, {
    environment,
    protocol: url.protocol,
    lookup: options.lookup,
  })

  const headers = { ...(config.headers ?? {}) }
  const secretResolver = options.secretResolver ?? createSecretResolver()
  assertSecretHeaderReferences(headers)
  for (const value of Object.values(headers)) secretResolver.resolve(value)

  return { kind: 'streamable_http', url, headers }
}

export async function createHttpRequestOptions(
  config: McpStreamableHttpTransportConfig,
  options: HttpTransportPolicyOptions = {},
): Promise<HttpRequestOptions> {
  const validated = await validateHttpTransport(config, options)
  const secretResolver = options.secretResolver ?? createSecretResolver()
  return {
    url: validated.url,
    headers: secretResolver.resolveHeaders(validated.headers),
    redirect: 'manual',
  }
}

export async function validateHttpRedirectTarget(
  sourceUrl: URL,
  target: string | URL,
  options: HttpTransportPolicyOptions = {},
): Promise<URL> {
  const targetUrl = new URL(target instanceof URL ? target.href : target, sourceUrl)
  if (sourceUrl.protocol === 'https:' && targetUrl.protocol === 'http:') {
    throw new McpSecurityError('MCP_CONFIG_INVALID')
  }
  const validated = await validateHttpTransport({ kind: 'streamable_http', url: targetUrl }, options)
  return validated.url
}

export function isBlockedNetworkAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, '').toLowerCase()
  const version = isIP(normalized)
  if (version === 4) return isBlockedIpv4(normalized)
  if (version === 6) return isBlockedIpv6(normalized)
  return false
}

export type ManagedStdioProcess = {
  kill: (signal?: NodeJS.Signals) => boolean | void
  once: (event: 'exit', listener: () => void) => unknown
}


export type StdioShutdownHost = {
  on: (event: 'SIGTERM' | 'SIGINT' | 'beforeExit', listener: () => void) => unknown
  removeListener: (event: 'SIGTERM' | 'SIGINT' | 'beforeExit', listener: () => void) => unknown
}

export function installStdioProcessShutdownHandlers(
  registry: StdioProcessRegistry,
  host: StdioShutdownHost = process,
): () => void {
  const cleanup = () => {
    void registry.terminateAll()
  }
  host.on('SIGTERM', cleanup)
  host.on('SIGINT', cleanup)
  host.on('beforeExit', cleanup)
  return () => {
    host.removeListener('SIGTERM', cleanup)
    host.removeListener('SIGINT', cleanup)
    host.removeListener('beforeExit', cleanup)
  }
}
export class StdioProcessRegistry {
  private readonly processes = new Set<ManagedStdioProcess>()
  private readonly gracePeriodMs: number

  constructor(options: { gracePeriodMs?: number } = {}) {
    this.gracePeriodMs = Math.max(0, options.gracePeriodMs ?? 2_000)
  }

  get size(): number {
    return this.processes.size
  }

  track(child: ManagedStdioProcess): () => void {
    this.processes.add(child)
    const unregister = () => this.processes.delete(child)
    child.once('exit', unregister)
    return unregister
  }

  untrack(child: ManagedStdioProcess): void {
    this.processes.delete(child)
  }

  async terminateAll(): Promise<void> {
    const children = [...this.processes]
    for (const child of children) child.kill('SIGTERM')
    await Promise.race([
      Promise.all(children.map((child) => this.waitForExit(child))),
      delay(this.gracePeriodMs),
    ])
    for (const child of children) {
      if (this.processes.has(child)) child.kill('SIGKILL')
    }
    this.processes.clear()
  }

  private waitForExit(child: ManagedStdioProcess): Promise<void> {
    if (!this.processes.has(child)) return Promise.resolve()
    return new Promise((resolve) => {
      child.once('exit', () => resolve())
    })
  }
}

async function assertSafeHttpHost(
  hostname: string,
  options: { environment: McpHttpEnvironment; protocol: string; lookup?: DnsLookup },
): Promise<void> {
  const normalized = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
  if (BLOCKED_HOSTNAMES.has(normalized)) throw new McpSecurityError('MCP_CONFIG_INVALID')

  const isLocalHost = isLocalDevelopmentHost(normalized)
  if (isLocalHost && isIP(normalized) !== 0) {
    if (!isLoopbackAddress(normalized)) throw new McpSecurityError('MCP_CONFIG_INVALID')
    return
  }
  if (!isLocalHost && isBlockedNetworkAddress(normalized)) {
    throw new McpSecurityError('MCP_CONFIG_INVALID')
  }

  const lookup = options.lookup ?? ((value: string) => dnsLookup(value, { all: true, verbatim: true }))
  let records: ReadonlyArray<{ address: string; family: number }>
  try {
    records = await lookup(normalized)
  } catch {
    throw new McpSecurityError('MCP_CONFIG_INVALID')
  }
  if (!records.length || records.some((record) => {
    if (isIP(record.address) === 0) return true
    return isLocalHost ? !isLoopbackAddress(record.address) : isBlockedNetworkAddress(record.address)
  })) {
    throw new McpSecurityError('MCP_CONFIG_INVALID')
  }
  if (options.environment === 'production' && options.protocol !== 'https:') {
    throw new McpSecurityError('MCP_CONFIG_INVALID')
  }
}

function canonicalizeTransportConfig(config: McpTransportConfig): Record<string, unknown> {
  if (!config || typeof config !== 'object') throw new McpSecurityError('MCP_CONFIG_INVALID')
  if (config.kind === 'stdio') {
    const validated = validateStdioTransport(config)
    return {
      kind: 'stdio',
      command: validated.command,
      args: [...validated.args],
      cwd: validated.cwd ?? null,
      env: sortRecord(validated.env),
    }
  }
  if (config.kind === 'streamable_http') {
    const url = normalizeHttpUrl(config.url)
    const headers = { ...(config.headers ?? {}) }
    assertSecretHeaderReferences(headers)
    return {
      kind: 'streamable_http',
      url: url.href,
      headers: sortRecord(headers),
    }
  }
  throw new McpSecurityError('MCP_CONFIG_INVALID')
}

function assertSecretHeaderReferences(headers: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(headers)) {
    if (!HEADER_NAME_PATTERN.test(name) || !parseSecretReference(value)) {
      throw new McpSecurityError('MCP_CONFIG_INVALID')
    }
  }
}

function sortRecord(record: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]))
}

function normalizeHttpUrl(input: string | URL): URL {
  let url: URL
  try {
    url = new URL(input instanceof URL ? input.href : input)
  } catch {
    throw new McpSecurityError('MCP_CONFIG_INVALID')
  }
  if (!['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || url.hash
    || !url.hostname
    || CONTROL_CHARACTER_PATTERN.test(url.href)) {
    throw new McpSecurityError('MCP_CONFIG_INVALID')
  }
  return url
}

function getEnvironment(value?: McpHttpEnvironment): McpHttpEnvironment {
  return value ?? (process.env.NODE_ENV === 'production' ? 'production' : 'development')
}

function isLoopbackAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, '').toLowerCase()
  return normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '::ffff:127.0.0.1'
}

function isLocalDevelopmentHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

function isUrlLikeCommand(command: string): boolean {
  return /^(?:https?|file|ftp):\/\//i.test(command)
}

function isPackageInstaller(command: string): boolean {
  const basename = command.split(/[\\/]/).pop()?.toLowerCase().replace(/\.cmd$|\.exe$/g, '')
  return basename !== undefined && PACKAGE_INSTALL_COMMANDS.has(basename)
}

function assertSafeText(value: string): void {
  if (typeof value !== 'string' || !value || CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new McpSecurityError('MCP_CONFIG_INVALID')
  }
}

function isBlockedIpv4(value: string): boolean {
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b, c] = parts
  return a === 0
    || a === 10
    || (a === 100 && b >= 64 && b <= 127)
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && b >= 18 && b <= 19)
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
}

function isBlockedIpv6(value: string): boolean {
  if (value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd')
    || /^fe[89ab]/.test(value) || value.startsWith('ff')) return true
  const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (mapped) return isBlockedIpv4(mapped[1])
  const expanded = expandIpv6(value)
  if (!expanded) return true
  const first = Number.parseInt(expanded[0], 16)
  return first === 0 || first >= 0xff00 || (first === 0x2001 && expanded[1] === '0db8')
}

function expandIpv6(value: string): string[] | null {
  const halves = value.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  if (left.some((part) => !/^[0-9a-f]{1,4}$/i.test(part)) || right.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null
  const missing = 8 - left.length - right.length
  if (missing < 0 || halves.length === 1 && missing !== 0) return null
  return [...left, ...Array.from({ length: missing }, () => '0'), ...right]
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
