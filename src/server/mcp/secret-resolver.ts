import type { EnvironmentLike } from './feature-flag'
import { McpSecurityError } from './types'

export const MCP_ALLOWED_ENV_NAMES = 'MCP_ALLOWED_ENV_NAMES' as const

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const SECRET_REFERENCE_PATTERN = /^\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

export type SecretReference = {
  readonly name: string
}

export type SecretResolverOptions = {
  env?: EnvironmentLike
  allowedNames?: Iterable<string>
}

export function parseSecretReference(value: unknown): SecretReference | null {
  if (typeof value !== 'string') return null
  const match = SECRET_REFERENCE_PATTERN.exec(value)
  return match ? { name: match[1] } : null
}

export function parseAllowedEnvironmentNames(value: string | undefined): ReadonlySet<string> {
  if (!value?.trim()) return new Set()
  const names = value.split(',').map((name) => name.trim()).filter(Boolean)
  if (names.some((name) => !ENV_NAME_PATTERN.test(name))) {
    throw new McpSecurityError('MCP_CONFIG_INVALID')
  }
  return new Set(names)
}

export class SecretResolver {
  readonly allowedNames: ReadonlySet<string>
  private readonly env: EnvironmentLike

  constructor(options: SecretResolverOptions = {}) {
    this.env = options.env ?? process.env
    this.allowedNames = options.allowedNames
      ? validateAllowedNames(options.allowedNames)
      : parseAllowedEnvironmentNames(this.env[MCP_ALLOWED_ENV_NAMES])
  }

  resolve(reference: string): string {
    const parsed = parseSecretReference(reference)
    if (!parsed || !this.allowedNames.has(parsed.name)) {
      throw new McpSecurityError('MCP_CONFIG_INVALID')
    }
    const value = this.env[parsed.name]
    if (value === undefined || value.includes('\u0000')) {
      throw new McpSecurityError('MCP_CONFIG_INVALID')
    }
    return value
  }

  resolveValue(value: string): string {
    if (parseSecretReference(value)) return this.resolve(value)
    if (value.includes('${')) throw new McpSecurityError('MCP_CONFIG_INVALID')
    if (value.includes('\u0000')) throw new McpSecurityError('MCP_CONFIG_INVALID')
    return value
  }

  resolveHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
    const resolved: Record<string, string> = {}
    for (const [name, value] of Object.entries(headers)) {
      if (!HEADER_NAME_PATTERN.test(name) || !parseSecretReference(value)) {
        throw new McpSecurityError('MCP_CONFIG_INVALID')
      }
      resolved[name] = this.resolve(value)
    }
    return resolved
  }

  resolveReferences<T>(value: T): T {
    return resolveWithResolver(value, this)
  }
}

export function createSecretResolver(options: SecretResolverOptions = {}): SecretResolver {
  return new SecretResolver(options)
}

export function resolveSecretReference(reference: string, options: SecretResolverOptions = {}): string {
  return new SecretResolver(options).resolve(reference)
}

export function resolveSecretReferences<T>(value: T, resolverOrOptions: SecretResolver | SecretResolverOptions = {}): T {
  const resolver = resolverOrOptions instanceof SecretResolver
    ? resolverOrOptions
    : new SecretResolver(resolverOrOptions)
  return resolver.resolveReferences(value)
}

function resolveWithResolver<T>(value: T, resolver: SecretResolver): T {
  if (typeof value === 'string') return resolver.resolveValue(value) as T
  if (Array.isArray(value)) return value.map((item) => resolveWithResolver(item, resolver)) as T
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(source)) {
      result[key] = resolveWithResolver(item, resolver)
    }
    return result as T
  }
  return value
}

function validateAllowedNames(names: Iterable<string>): ReadonlySet<string> {
  const result = new Set<string>()
  for (const name of names) {
    if (!ENV_NAME_PATTERN.test(name)) throw new McpSecurityError('MCP_CONFIG_INVALID')
    result.add(name)
  }
  return result
}
