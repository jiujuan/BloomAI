import { describe, expect, it } from 'vitest'
import { sanitizeReferenceImages } from './image-studio.service'

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
