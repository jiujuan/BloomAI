import React from 'react'
import type { ResearchDepth, ResearchProfile } from '@shared/deepresearch/contracts'
import type { DeepResearchDraft } from './deep-research.types'

export const RESEARCH_PROFILE_OPTIONS: Array<{ id: ResearchProfile; label: string }> = [
  { id: 'general', label: '通用研究' },
  { id: 'market', label: '市场研究' },
  { id: 'competitor', label: '竞品研究' },
  { id: 'academic', label: '学术研究' },
]

export const RESEARCH_DEPTH_OPTIONS: Array<{ id: ResearchDepth; label: string }> = [
  { id: 'standard', label: '标准' },
  { id: 'deep', label: '深入' },
  { id: 'exhaustive', label: '穷尽' },
]

export interface DeepResearchLauncherProps {
  draft: DeepResearchDraft
  loading: boolean
  error: string | null
  onDraftChange: (patch: Partial<DeepResearchDraft>) => void
  onStart: () => void
}

export function isResearchDraftValid(draft: DeepResearchDraft): boolean {
  return draft.topic.trim().length > 0
}

export function DeepResearchLauncher({ draft, loading, error, onDraftChange, onStart }: DeepResearchLauncherProps) {
  const valid = isResearchDraftValid(draft)

  return (
    <section className="deep-research-launcher" aria-labelledby="deep-research-launcher-title">
      <header className="deep-research-heading">
        <h2 id="deep-research-launcher-title">深度研究</h2>
      </header>

      <label className="deep-research-field deep-research-topic-field">
        <span>研究主题</span>
        <textarea
          value={draft.topic}
          onChange={(event) => onDraftChange({ topic: event.target.value })}
          placeholder="输入需要深入研究的主题或问题"
          rows={3}
          disabled={loading}
        />
      </label>

      <div className="deep-research-segment-row" role="tablist" aria-label="研究类型">
        <span className="deep-research-row-label">类型</span>
        <div className="deep-research-segments">
          {RESEARCH_PROFILE_OPTIONS.map((option) => (
            <button
              type="button"
              role="tab"
              key={option.id}
              aria-selected={draft.profile === option.id}
              className="deep-research-segment"
              onClick={() => onDraftChange({ profile: option.id })}
              disabled={loading}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="deep-research-segment-row" role="tablist" aria-label="研究深度">
        <span className="deep-research-row-label">深度</span>
        <div className="deep-research-segments">
          {RESEARCH_DEPTH_OPTIONS.map((option) => (
            <button
              type="button"
              role="tab"
              key={option.id}
              aria-selected={draft.depth === option.id}
              className="deep-research-segment"
              onClick={() => onDraftChange({ depth: option.id })}
              disabled={loading}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="deep-research-scope-grid">
        <label className="deep-research-field">
          <span>研究目标</span>
          <input value={draft.objective ?? ''} onChange={(event) => onDraftChange({ objective: event.target.value || undefined })} disabled={loading} />
        </label>
        <label className="deep-research-field">
          <span>受众</span>
          <input value={draft.audience ?? ''} onChange={(event) => onDraftChange({ audience: event.target.value || undefined })} disabled={loading} />
        </label>
        <label className="deep-research-field">
          <span>地域范围</span>
          <input value={(draft.geography ?? []).join(', ')} onChange={(event) => onDraftChange({ geography: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} placeholder="例如：中国、美国" disabled={loading} />
        </label>
      </div>

      {error && <p className="deep-research-error" role="alert">{error}</p>}
      <div className="deep-research-launcher-actions">
        <button type="button" className="deep-research-primary-action" onClick={onStart} disabled={loading || !valid}>
          {loading ? '正在创建研究' : '开始研究'}
        </button>
      </div>
    </section>
  )
}
