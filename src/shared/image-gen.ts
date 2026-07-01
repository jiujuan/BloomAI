// Single source of truth for the AI 画图 (Image Studio) typed parameters.
// Both the renderer (renders the ratio / style dropdowns) and the server (resolves a
// structured request into a concrete provider call) read these tables, so the two sides
// can never drift. Adding a new ratio / style = add one entry here; no UI or provider
// plumbing changes.
//
// See docs/ai-images/ai-image-studio-technical-design.md §4.

/** One aspect-ratio option: value + semantic hint + concrete output size. */
export interface AspectRatioDef {
  id: string // '1:1' | '2:3' | ...
  label: string // '1:1'
  hint: string // '正方形，头像'
  size: string // '1024x1024' (generic WxH; providers clamp to their supported set)
  orientation: 'square' | 'portrait' | 'landscape'
}

export const ASPECT_RATIOS: AspectRatioDef[] = [
  { id: '1:1', label: '1:1', hint: '正方形，头像', size: '1024x1024', orientation: 'square' },
  { id: '2:3', label: '2:3', hint: '社交媒体，自拍', size: '832x1248', orientation: 'portrait' },
  { id: '3:4', label: '3:4', hint: '经典比例，拍照', size: '896x1152', orientation: 'portrait' },
  { id: '4:3', label: '4:3', hint: '文章配图，插画', size: '1152x896', orientation: 'landscape' },
  { id: '9:16', label: '9:16', hint: '手机壁纸，人像', size: '768x1344', orientation: 'portrait' },
  { id: '16:9', label: '16:9', hint: '桌面壁纸，风景', size: '1344x768', orientation: 'landscape' },
]

export const DEFAULT_ASPECT_RATIO = '1:1'

/** One style option, mapping to a prompt-enhancement suffix appended to the user's prompt. */
export interface ImageStyleDef {
  id: string
  label: string // '油画'
  promptSuffix: string // ', oil painting, textured brush strokes, rich color, classical art'
}

export const IMAGE_STYLES: ImageStyleDef[] = [
  { id: 'portrait-photo', label: '人像摄影', promptSuffix: ', portrait photography, 85mm lens, soft light, shallow depth of field' },
  { id: 'cinematic', label: '电影写真', promptSuffix: ', cinematic, film still, dramatic lighting, color grading' },
  { id: 'chinese', label: '中国风', promptSuffix: ', Chinese traditional style, elegant composition, refined detail' },
  { id: 'anime', label: '动漫', promptSuffix: ', anime style, clean lineart, cel shading, vibrant' },
  { id: '3d', label: '3D 渲染', promptSuffix: ', 3D render, octane, physically based, high detail' },
  { id: 'cyberpunk', label: '赛博朋克', promptSuffix: ', cyberpunk, neon lights, rainy night, high contrast' },
  { id: 'cg', label: 'CG 动画', promptSuffix: ', CG animation, Pixar-like, stylized, vivid' },
  { id: 'ink', label: '水墨画', promptSuffix: ', Chinese ink wash painting, minimal, negative space' },
  { id: 'oil', label: '油画', promptSuffix: ', oil painting, textured brush strokes, rich color' },
  { id: 'classical', label: '古典', promptSuffix: ', classical painting, renaissance, museum quality' },
  { id: 'watercolor', label: '水彩画', promptSuffix: ', watercolor, soft gradient, wet-on-wet, delicate' },
  { id: 'cartoon', label: '卡通', promptSuffix: ', cartoon, flat color, bold outline, playful' },
]

/** Extra capability metadata beyond DB `modality=image`, for UI badges and feature gating. */
export interface ImageModelCap {
  supportsImg2Img: boolean
  async: boolean // Midjourney-like task+poll
  local: boolean // Ollama
}

export const IMAGE_MODEL_CAPS: Record<string, Partial<ImageModelCap>> = {
  'agnes-image-2.1-flash': { supportsImg2Img: true },
  'dall-e-3': { supportsImg2Img: false },
  'gpt-image-1': { supportsImg2Img: true },
  midjourney: { supportsImg2Img: true, async: true },
}

export function getAspectRatio(id: string | null | undefined): AspectRatioDef | undefined {
  return ASPECT_RATIOS.find((a) => a.id === id)
}

export function getImageStyle(id: string | null | undefined): ImageStyleDef | undefined {
  return IMAGE_STYLES.find((s) => s.id === id)
}

/** The composer parameter shape sent in the generate request body. */
export interface ImageGenParams {
  prompt: string
  model: string
  aspectRatioId?: string
  styleId?: string | null
  referenceImages?: string[] // Data URI or URL (v1: local Data URI direct to provider)
  negativePrompt?: string
  seed?: number
  optimize?: boolean // Agent prompt optimization, default on
}
