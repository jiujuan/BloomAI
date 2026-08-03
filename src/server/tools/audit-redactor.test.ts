import { describe, expect, it } from 'vitest'
import { redactRunPayload } from './audit-redactor'

describe('tool audit redactor', () => {
  it('redacts secrets and sensitive URL query values', () => {
    const result = redactRunPayload({
      authorization: 'Bearer super-secret-token',
      cookie: 'session=secret-cookie',
      apiKey: 'api-secret',
      url: 'https://example.com/page?token=query-secret&keep=value',
      nested: { password: 'hunter2' },
    })

    const stored = JSON.stringify(result.summary)
    expect(stored).not.toContain('super-secret-token')
    expect(stored).not.toContain('secret-cookie')
    expect(stored).not.toContain('api-secret')
    expect(stored).not.toContain('hunter2')
    expect(stored).not.toContain('query-secret')
    expect(stored).toContain('keep=value')
    expect(result.redactedFields).toEqual(expect.arrayContaining([
      'authorization',
      'cookie',
      'apiKey',
      'nested.password',
      'url.search.token',
    ]))
  })

  it('bounds large payloads and keeps a digest for diagnostics', () => {
    const result = redactRunPayload({ content: 'x'.repeat(20_000) }, { maxStoredBytes: 256 })

    expect(result.truncated).toBe(true)
    expect(result.originalBytes).toBeGreaterThan(result.storedBytes)
    expect(result.storedBytes).toBeLessThanOrEqual(256)
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(result.summary).length).toBeLessThanOrEqual(256)
  })

  it('redacts absolute user paths while preserving a useful marker', () => {
    const result = redactRunPayload({
      path: 'C:\\Users\\alice\\Documents\\secret.txt',
      home: '/Users/alice/private.txt',
    })

    const stored = JSON.stringify(result.summary)
    expect(stored).not.toContain('alice')
    expect(stored).toContain('[PRIVATE_PATH]')
    expect(result.redactedFields).toEqual(expect.arrayContaining(['path', 'home']))
  })
})
