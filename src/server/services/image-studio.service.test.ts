import { describe, expect, it } from 'vitest'
import { sanitizeReferenceImages, looksLikeRefusal } from './image-studio.service'

describe('sanitizeReferenceImages', () => {
  it('keeps data: and http(s) URLs', () => {
    const out = sanitizeReferenceImages('agnes-image-2.1-flash', [
      'data:image/png;base64,AAA',
      'https://example.com/a.png',
      'http://example.com/b.jpg',
    ])
    expect(out).toHaveLength(3)
  })

  it('drops malformed / non-string entries', () => {
    const out = sanitizeReferenceImages('agnes-image-2.1-flash', ['ftp://x', 'not a url', 123, null, undefined])
    expect(out).toEqual([])
  })

  it('caps at 4 images', () => {
    const many = Array.from({ length: 7 }, (_, i) => `data:image/png;base64,${i}`)
    expect(sanitizeReferenceImages('agnes-image-2.1-flash', many)).toHaveLength(4)
  })

  it('returns [] for a model that cannot do img2img (dall-e-3)', () => {
    expect(sanitizeReferenceImages('dall-e-3', ['data:image/png;base64,AAA'])).toEqual([])
  })

  it('returns [] when images is not an array', () => {
    expect(sanitizeReferenceImages('agnes-image-2.1-flash', undefined)).toEqual([])
    expect(sanitizeReferenceImages('agnes-image-2.1-flash', 'data:image/png;base64,AAA')).toEqual([])
  })
})

describe('looksLikeRefusal', () => {
  it('flags the observed provider refusal string', () => {
    expect(looksLikeRefusal('Unable to generate this content. Please modify your prompt and try again.')).toBe(true)
  })

  it('flags common LLM refusal / apology phrasings', () => {
    expect(looksLikeRefusal("I'm sorry, but I can't help with that.")).toBe(true)
    expect(looksLikeRefusal('I cannot create this image as it violates the content policy.')).toBe(true)
    expect(looksLikeRefusal('As an AI, I am unable to assist with this request.')).toBe(true)
  })

  it('does not flag a normal optimized image prompt', () => {
    expect(
      looksLikeRefusal(
        'A Shenzhen street on a bright summer afternoon, lush green roadside trees, tall glass skyscrapers, warm golden sunlight, gentle sea breeze, natural lifelike scene'
      )
    ).toBe(false)
  })
})
