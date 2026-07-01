import {
  WRITING_TYPES,
  getWritingTypeDef,
  isWritingType,
  type WritingConfig,
} from '@shared/writing'

// Builds the AI Writer agent's system instructions from the typed parameters chosen in the UI,
// and validates the raw request payload before it reaches the prompt. Both read the shared
// WRITING_TYPES table (see @shared/writing), so the frontend dropdowns and this prompt logic
// stay in lockstep — a new writing type needs only a config entry, not changes here.

const BASE = '你是专业中文写作助手。仅依据对话与用户提供的素材写作；信息不足时只问一个最关键的澄清问题。'

/** Per-type high-level guidance, keyed by WritingType. */
const TYPE_GUIDE: Record<string, string> = {
  general: '产出一篇通用文章，结构清晰、开头抓人、分段合理。',
  'work-summary':
    '产出一份职场工作总结：突出成果与量化数据、复盘问题、给出改进与规划，条理化分点。',
  xiaohongshu:
    '产出小红书风格文案：口语化、有情绪价值、善用 emoji 与分段短句，结尾给行动号召，并附 3-6 个相关话题标签（#…）。',
}

/**
 * Turn a validated WritingConfig into a system-instructions string. `undefined` (no config,
 * e.g. an old client or a non-writing request) falls back to the original generic writer prompt,
 * so behavior is unchanged when no typed parameters are supplied.
 */
export function buildWriterInstructions(cfg?: WritingConfig): string {
  if (!cfg || !isWritingType(cfg.type)) {
    return `${BASE}\n根据用户意图（语气/篇幅/受众）自适应写作。`
  }
  const def = getWritingTypeDef(cfg.type)!
  const lines: string[] = [BASE, TYPE_GUIDE[cfg.type] ?? '']
  // Translate each chosen parameter into a Chinese constraint, in field order. Placeholder
  // (unset) or unknown values are skipped, leaving that dimension to the model.
  for (const f of def.fields) {
    const v = cfg.params?.[f.key]
    if (!v || !f.options.includes(v)) continue
    if (f.key === 'words') lines.push(`目标字数约 ${v} 字（允许 ±15%）。`)
    else if (f.key === 'platform') lines.push(`发布平台：${v}，遵循该平台的排版与调性习惯。`)
    else lines.push(`${f.label}：${v}。`)
  }
  return lines.filter(Boolean).join('\n')
}

/**
 * Whitelist-normalize an untrusted `body.writing` payload: the type must be known, and each
 * param key/value must be defined by that type's fields. Anything else is dropped, so only
 * vetted values ever reach the prompt. Returns undefined when there's no usable config.
 */
export function normalizeWriting(raw: any): WritingConfig | undefined {
  if (!raw || !isWritingType(raw.type)) return undefined
  const def = WRITING_TYPES.find((w) => w.id === raw.type)!
  const params: Record<string, string> = {}
  for (const f of def.fields) {
    const v = raw?.params?.[f.key]
    if (typeof v === 'string' && f.options.includes(v)) params[f.key] = v
  }
  return { type: raw.type, params }
}
