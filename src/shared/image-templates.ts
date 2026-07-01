// Built-in image templates shown in the AI 画图 right-column gallery. Frontend renders the
// cards; the server exposes them via GET /api/v1/image-templates. Kept as shared constants
// (versioned with the app) rather than DB rows so they evolve with releases. A "做同款"
// click copies `prompt` into the composer and applies the recommended params.
//
// Thumbnails reference packaged renderer assets; until real art is added, cards fall back to
// a gradient placeholder keyed by `id`.

export interface ImageTemplateDef {
  id: string
  title: string
  category: string // '人像' | '风景' | '二次元' | '商业' | '壁纸' | '国风'
  tags: string[]
  thumb?: string // renderer asset path; optional placeholder fallback
  prompt: string
  recommend?: { model?: string; ratioId?: string; styleId?: string }
}

export const IMAGE_TEMPLATE_CATEGORIES = ['全部', '人像', '风景', '二次元', '商业', '壁纸', '国风'] as const

export const IMAGE_TEMPLATES: ImageTemplateDef[] = [
  {
    id: 'cyberpunk-city',
    title: '赛博朋克城市',
    category: '风景',
    tags: ['科幻', '霓虹', '夜景'],
    prompt:
      'A futuristic cyberpunk city at night, rain-soaked streets with neon reflections, towering skyscrapers, holographic signs, flying vehicles, cinematic wide-angle composition, high visual density',
    recommend: { ratioId: '16:9', styleId: 'cyberpunk' },
  },
  {
    id: 'healing-illustration',
    title: '治愈系插画',
    category: '二次元',
    tags: ['插画', '清新', '温暖'],
    prompt:
      'A cozy healing-style illustration, a girl reading by a large window on a rainy afternoon, warm indoor light, plants and books, soft pastel colors, gentle atmosphere',
    recommend: { ratioId: '3:4', styleId: 'anime' },
  },
  {
    id: 'portrait-studio',
    title: '人像写真',
    category: '人像',
    tags: ['写真', '摄影', '光影'],
    prompt:
      'A professional studio portrait of a young woman, soft key light, clean background, natural skin texture, shallow depth of field, editorial photography',
    recommend: { ratioId: '2:3', styleId: 'portrait-photo' },
  },
  {
    id: 'ink-landscape',
    title: '国风水墨',
    category: '国风',
    tags: ['水墨', '山水', '留白'],
    prompt:
      'A traditional Chinese ink wash landscape, misty mountains and a lone boat on a calm river, minimalist composition, abundant negative space, elegant brush strokes',
    recommend: { ratioId: '4:3', styleId: 'ink' },
  },
  {
    id: 'product-render',
    title: '产品渲染图',
    category: '商业',
    tags: ['产品', '3D', '质感'],
    prompt:
      'A premium product render of a glass perfume bottle on a marble surface, studio lighting, soft shadows, reflective highlights, ultra-detailed, commercial photography',
    recommend: { ratioId: '1:1', styleId: '3d' },
  },
  {
    id: 'mountain-wallpaper',
    title: '风光壁纸',
    category: '壁纸',
    tags: ['风景', '壁纸', '大气'],
    prompt:
      'A breathtaking mountain landscape at golden hour, dramatic clouds, alpine lake reflection, ultra-wide vista, rich detail, desktop wallpaper quality',
    recommend: { ratioId: '16:9', styleId: 'cinematic' },
  },
]

export function listTemplatesByCategory(category?: string): ImageTemplateDef[] {
  if (!category || category === '全部') return IMAGE_TEMPLATES
  return IMAGE_TEMPLATES.filter((t) => t.category === category)
}
