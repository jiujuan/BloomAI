import { describe, expect, it } from 'vitest'
import { ASPECT_RATIOS, DEFAULT_ASPECT_RATIO, IMAGE_STYLES, getAspectRatio, getImageStyle } from './image-gen'
import { IMAGE_TEMPLATES, listTemplatesByCategory } from './image-templates'

describe('image-gen config', () => {
  it('every aspect ratio has a WxH size and a known orientation', () => {
    for (const r of ASPECT_RATIOS) {
      expect(r.size).toMatch(/^\d+x\d+$/)
      expect(['square', 'portrait', 'landscape']).toContain(r.orientation)
    }
  })

  it('DEFAULT_ASPECT_RATIO resolves to a real ratio', () => {
    expect(getAspectRatio(DEFAULT_ASPECT_RATIO)).toBeDefined()
  })

  it('getAspectRatio returns undefined for unknown / empty ids', () => {
    expect(getAspectRatio('nope')).toBeUndefined()
    expect(getAspectRatio(null)).toBeUndefined()
  })

  it('every style has a non-empty prompt suffix', () => {
    for (const s of IMAGE_STYLES) {
      expect(s.promptSuffix.trim().length).toBeGreaterThan(0)
    }
  })

  it('getImageStyle resolves a known style and ignores unknown', () => {
    expect(getImageStyle('oil')?.label).toBe('油画')
    expect(getImageStyle(null)).toBeUndefined()
  })
})

describe('image templates', () => {
  it('"全部" returns all templates; a category filters', () => {
    expect(listTemplatesByCategory('全部')).toHaveLength(IMAGE_TEMPLATES.length)
    const scenery = listTemplatesByCategory('风景')
    expect(scenery.length).toBeGreaterThan(0)
    expect(scenery.every((t) => t.category === '风景')).toBe(true)
  })

  it('every template has a non-empty prompt', () => {
    for (const t of IMAGE_TEMPLATES) {
      expect(t.prompt.trim().length).toBeGreaterThan(0)
    }
  })
})
