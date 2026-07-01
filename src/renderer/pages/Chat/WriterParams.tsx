import React from 'react'
import { cn } from '@renderer/utils'
import {
  WRITING_TYPES,
  DEFAULT_WRITING_TYPE,
  getWritingTypeDef,
  type WritingConfig,
  type WritingType,
} from '@shared/writing'

/**
 * AI Writer parameter controls: a writing-type selector plus the parameter dropdowns
 * that type defines. Fully driven by WRITING_TYPES (see @shared/writing) — adding a new
 * writing type needs no change here, only a new config entry.
 *
 * Self-contained and controlled: the parent owns a single WritingConfig value and gets
 * onChange callbacks. Rendered only while the AI 写作 tab is active.
 */
export interface WriterParamsProps {
  value: WritingConfig
  onChange: (next: WritingConfig) => void
  disabled?: boolean
}

/** Initial config for a freshly activated AI Writer tab: default type, no params chosen. */
export function defaultWritingConfig(): WritingConfig {
  return { type: DEFAULT_WRITING_TYPE, params: {} }
}

export function WriterParams({ value, onChange, disabled }: WriterParamsProps) {
  const def = getWritingTypeDef(value.type)

  // Switching type rebuilds the parameter row and clears all params, so e.g. a work-summary
  // 字数=4000 can't leak into 小红书 (which caps at 500).
  const selectType = (type: WritingType) => {
    if (type === value.type) return
    onChange({ type, params: {} })
  }

  // Empty string = the placeholder (field-name) option = "not constrained": drop the key.
  const selectParam = (key: string, raw: string) => {
    const params = { ...value.params }
    if (raw) params[key] = raw
    else delete params[key]
    onChange({ type: value.type, params })
  }

  return (
    <div className="writer-params">
      <div className="writer-params-row" role="tablist" aria-label="写作类型">
        <span className="row-label">类型</span>
        {WRITING_TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={value.type === t.id}
            className={cn('writer-type', value.type === t.id && 'active')}
            onClick={() => selectType(t.id)}
            disabled={disabled}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="writer-params-row">
        <span className="row-label">参数</span>
        {def?.fields.map((f) => (
          <select
            key={f.key}
            className="field-select"
            aria-label={f.label}
            value={value.params[f.key] ?? ''}
            onChange={(e) => selectParam(f.key, e.target.value)}
            disabled={disabled}
          >
            <option value="">{f.label}</option>
            {f.options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        ))}
      </div>
    </div>
  )
}
