import { describe, expect, it } from 'vitest'
import { getToolContract, schemaToJsonSchema } from './contracts'

describe('tool contracts', () => {
  it('applies defaults and rejects invalid input before the executor boundary', () => {
    const contract = getToolContract('web_search')
    expect(contract).toBeDefined()

    expect(contract!.inputSchema.parse({ query: 'zod' })).toMatchObject({ query: 'zod', limit: 8 })
    expect(() => contract!.inputSchema.parse({ query: '', limit: 0 })).toThrow()
    expect(() => contract!.inputSchema.parse({ query: 'zod', limit: 51 })).toThrow()
  })

  it('enforces the vision exactly-one source rule', () => {
    const contract = getToolContract('vision')
    expect(contract).toBeDefined()

    expect(() => contract!.inputSchema.parse({ question: 'describe' })).toThrow()
    expect(() => contract!.inputSchema.parse({
      imagePath: 'one.png',
      imageUrl: 'https://example.com/two.png',
    })).toThrow()
    expect(contract!.inputSchema.parse({ imagePath: 'one.png' })).toMatchObject({
      imagePath: 'one.png',
      question: 'Describe this image in detail.',
    })
  })

  it('exports the same bounded field map used by the UI', () => {
    const contract = getToolContract('web_fetch')
    expect(contract).toBeDefined()

    const schema = schemaToJsonSchema(contract!.inputSchema)
    expect(schema).toMatchObject({
      url: { type: 'string' },
      mode: { type: 'string', enum: ['text', 'html', 'full'], default: 'text' },
      maxChars: { type: 'integer', maximum: 1_000_000 },
    })
  })
})
