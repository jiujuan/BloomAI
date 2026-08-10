import { describe, expect, it } from 'vitest'
import {
  SecretResolver,
  createSecretResolver,
  parseSecretReference,
  resolveSecretReferences,
} from '../secret-resolver'
import { McpSecurityError } from '../types'

describe('MCP secret resolver contract', () => {
  const env = {
    MCP_ALLOWED_ENV_NAMES: 'MCP_TOKEN, API_KEY',
    MCP_TOKEN: 'synthetic-token-value',
    API_KEY: 'synthetic-api-key-value',
    NOT_ALLOWED: 'must-not-be-readable',
  }

  it('accepts only exact env templates', () => {
    expect(parseSecretReference('${env:MCP_TOKEN}')).toEqual({ name: 'MCP_TOKEN' })
    expect(parseSecretReference('${env:API_KEY}')).toEqual({ name: 'API_KEY' })
    expect(parseSecretReference('${env:MCP_TOKEN}-suffix')).toBeNull()
    expect(parseSecretReference('${process.env:MCP_TOKEN}')).toBeNull()
    expect(parseSecretReference('${env:bad-name}')).toBeNull()
    expect(parseSecretReference('MCP_TOKEN')).toBeNull()
  })

  it('resolves only allowlisted environment names and keeps errors value-free', () => {
    const resolver = createSecretResolver({ env })
    expect(resolver.resolve('${env:MCP_TOKEN}')).toBe(env.MCP_TOKEN)
    expect(() => resolver.resolve('${env:NOT_ALLOWED}')).toThrowError(
      new McpSecurityError('MCP_CONFIG_INVALID'),
    )
    expect(() => resolver.resolve('${env:MISSING}')).toThrowError(
      new McpSecurityError('MCP_CONFIG_INVALID'),
    )
    try {
      resolver.resolve('${env:NOT_ALLOWED}')
    } catch (error) {
      expect(String(error)).not.toContain(env.NOT_ALLOWED)
    }
  })

  it('resolves references recursively without inheriting unrelated environment values', () => {
    const resolver = new SecretResolver({ env })
    const resolved = resolveSecretReferences({
      headers: { authorization: '${env:MCP_TOKEN}' },
      nested: ['literal', '${env:API_KEY}'],
      plain: 'not a secret reference',
    }, resolver)

    expect(resolved).toEqual({
      headers: { authorization: env.MCP_TOKEN },
      nested: ['literal', env.API_KEY],
      plain: 'not a secret reference',
    })
    expect(JSON.stringify(resolved)).toContain(env.MCP_TOKEN)
    expect(JSON.stringify(resolved)).not.toContain(env.NOT_ALLOWED)
  })

  it('requires HTTP header values to be secret references', () => {
    const resolver = new SecretResolver({ env })
    expect(resolver.resolveHeaders({ Authorization: '${env:MCP_TOKEN}' }))
      .toEqual({ Authorization: env.MCP_TOKEN })
    expect(() => resolver.resolveHeaders({ Authorization: 'Bearer literal-token' }))
      .toThrowError(new McpSecurityError('MCP_CONFIG_INVALID'))
    expect(() => resolver.resolveHeaders({ 'Bad\nHeader': '${env:MCP_TOKEN}' }))
      .toThrowError(new McpSecurityError('MCP_CONFIG_INVALID'))
  })

  it('rejects malformed allowlists instead of silently broadening access', () => {
    expect(() => createSecretResolver({ env: { MCP_ALLOWED_ENV_NAMES: 'GOOD_NAME,bad-name' } }))
      .toThrowError(new McpSecurityError('MCP_CONFIG_INVALID'))
  })
})
