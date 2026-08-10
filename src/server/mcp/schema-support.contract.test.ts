import { describe, expect, it } from 'vitest'
import {
  MCP_SCHEMA_MAX_DEPTH,
  analyzeMcpSchema,
  hashMcpSchema,
  normalizeMcpSchema,
} from './schema-support'

function expectUnsupported(callback: () => unknown): void {
  try {
    callback()
    throw new Error('Expected MCP_SCHEMA_UNSUPPORTED')
  } catch (error) {
    expect(error).toMatchObject({ code: 'MCP_SCHEMA_UNSUPPORTED' })
    expect((error as Error).message).toBe('MCP_SCHEMA_UNSUPPORTED: MCP schema is outside the supported subset')
  }
}

describe('MCP JSON Schema boundary contract', () => {
  it('supports the一期 JSON Schema subset and normalizes object key order', () => {
    const first = {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        count: { type: 'integer' },
        enabled: { type: 'boolean' },
        ratio: { type: 'number' },
        value: { type: 'null' },
        tags: { type: 'array', items: { type: 'string' } },
        choice: { enum: ['a', 'b'] },
      },
    }
    const reordered = {
      properties: {
        choice: { enum: ['b', 'a'] },
        tags: { items: { type: 'string' }, type: 'array' },
        value: { type: 'null' },
        ratio: { type: 'number' },
        enabled: { type: 'boolean' },
        count: { type: 'integer' },
        name: { type: 'string' },
      },
      required: ['name'],
      type: 'object',
    }

    expect(normalizeMcpSchema(first)).toEqual(normalizeMcpSchema(reordered))
    expect(hashMcpSchema(first)).toBe(hashMcpSchema(reordered))
  })

  it('supports structural object and array schemas without an explicit type', () => {
    expect(normalizeMcpSchema({
      properties: { query: { type: 'string' } },
      required: ['query'],
    })).toEqual({
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    })
    expect(normalizeMcpSchema({ items: { type: 'string' } })).toEqual({
      type: 'array',
      items: { type: 'string' },
    })
  })

  it('rejects refs, unknown keywords, arbitrary values, cycles, and excessive depth', () => {
    expectUnsupported(() => normalizeMcpSchema({ $ref: '#/$defs/Tool' }))
    expectUnsupported(() => normalizeMcpSchema({ type: 'object', additionalProperties: false }))
    expectUnsupported(() => normalizeMcpSchema({ type: 'object', properties: { value: { type: 'string', transform: () => 'x' } } }))
    expectUnsupported(() => normalizeMcpSchema({ type: 'string', default: 'secret' }))

    const circular: Record<string, unknown> = { type: 'array' }
    circular.items = circular
    expectUnsupported(() => normalizeMcpSchema(circular))

    let deep: Record<string, unknown> = { type: 'string' }
    for (let index = 0; index < MCP_SCHEMA_MAX_DEPTH + 1; index += 1) {
      deep = { type: 'array', items: deep }
    }
    expectUnsupported(() => normalizeMcpSchema(deep))
  })

  it('keeps unsupported discovery data out of the Agent Tool Surface', () => {
    const analysis = analyzeMcpSchema({ $ref: '#/$defs/unsupported' })

    expect(analysis).toMatchObject({
      supported: false,
      errorCode: 'MCP_SCHEMA_UNSUPPORTED',
    })
    expect(analysis.normalizedSchema).toBeUndefined()
    expect(analysis.schemaHash).toBeUndefined()
  })
})
