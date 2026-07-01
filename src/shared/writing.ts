// Single source of truth for the AI Writer agent's typed parameters.
// Both the renderer (renders the type selector + parameter dropdowns) and the server
// (validates the incoming config and builds the writer's system instructions) read this
// table, so the two sides can never drift. Adding a new writing type = add one entry here;
// no UI or prompt-plumbing code needs to change.
//
// See docs/agent/003-writer-agent-ai-writing-typed-params-design.md.

export type WritingType = 'general' | 'work-summary' | 'xiaohongshu'

/**
 * One parameter dropdown.
 * - `key`     stable identifier stored in WritingConfig.params and read when building the prompt.
 * - `label`   the field name, shown as the placeholder (index-0) option = "not constrained".
 * - `options` the selectable values (does NOT include the placeholder).
 */
export interface WritingField {
  key: string
  label: string
  options: string[]
}

export interface WritingTypeDef {
  id: WritingType
  label: string
  fields: WritingField[]
}

export const WRITING_TYPES: WritingTypeDef[] = [
  {
    id: 'general',
    label: '通用',
    fields: [
      { key: 'platform', label: '发布平台', options: ['公众号', '知乎', '头条号'] },
      { key: 'style', label: '写作风格', options: ['正式', '口语', '幽默', '简洁', '抒情', '夸张'] },
      { key: 'words', label: '字数', options: ['200', '500', '1000', '2000'] },
    ],
  },
  {
    id: 'work-summary',
    label: '工作总结',
    fields: [
      { key: 'kind', label: '类型', options: ['个人总结', '转正述职', '实习报告', '工作日报', '工作周报', '工作月报'] },
      { key: 'style', label: '风格', options: ['正式', '简洁', '客观', '数据化'] },
      { key: 'words', label: '字数', options: ['200', '500', '1000', '2000', '4000'] },
    ],
  },
  {
    id: 'xiaohongshu',
    label: '小红书文案',
    fields: [
      { key: 'scene', label: '场景', options: ['通用场景', '物品介绍', '旅行介绍', '美食攻略', '体验记录'] },
      { key: 'style', label: '风格', options: ['正式', '简洁', '种草转化', '品牌专家'] },
      { key: 'words', label: '字数', options: ['50', '100', '200', '300', '400', '500'] },
    ],
  },
]

/** Default writing type when the AI Writer tab is first activated. */
export const DEFAULT_WRITING_TYPE: WritingType = 'general'

/** The shape sent in the request body and stored on the RequestContext. */
export interface WritingConfig {
  type: WritingType
  params: Record<string, string>
}

export function isWritingType(t: unknown): t is WritingType {
  return WRITING_TYPES.some((w) => w.id === t)
}

export function getWritingTypeDef(type: WritingType): WritingTypeDef | undefined {
  return WRITING_TYPES.find((w) => w.id === type)
}
