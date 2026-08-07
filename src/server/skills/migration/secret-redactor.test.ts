import { describe, expect, it } from 'vitest'
import { redactSecrets, redactWithStats } from './secret-redactor'

describe('migration secret redactor', () => {
  it('redacts secret keys across headers, query, body, env, logs, and artifacts', () => {
    const result = redactSecrets({
      headers: { Authorization: 'Bearer abc.def.ghi', 'x-api-key': 'key-123' },
      url: 'https://example.test/a?access_token=query-secret&safe=1',
      query: { signature: 'sig-secret', page: 1 },
      body: { password: 'pw', nested: { value: 'Bearer body-secret' } },
      env: { API_TOKEN: 'env-secret' },
      log: 'request token=log-secret',
      artifact: { credential: 'artifact-secret' },
    }) as any
    expect(JSON.stringify(result)).not.toMatch(/abc\.def\.ghi|key-123|query-secret|sig-secret|pw|body-secret|env-secret|log-secret|artifact-secret/)
    expect(result.headers.Authorization).toBe('[REDACTED]')
    expect(result.headers['x-api-key']).toBe('[REDACTED]')
    expect(result.url).toContain('access_token=[REDACTED]')
  })

  it('redacts high entropy values and returns coverage stats', () => {
    const secret = 'q7M2vP9xL4aR8nT1zK6cW3eY5uI0oP'
    const result = redactWithStats({ log: secret, ordinary: 'hello world' })
    expect(result.value).toMatchObject({ log: '[REDACTED]', ordinary: 'hello world' })
    expect(result.stats.redactedCount).toBe(1)
  })
})
