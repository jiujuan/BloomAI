import React, { useState } from 'react'
import type { ResearchSourceDto } from '@shared/deepresearch/contracts'

export type ResearchSourceFilter = 'all' | ResearchSourceDto['selectionStatus']

export function filterResearchSources(sources: ResearchSourceDto[], filter: ResearchSourceFilter): ResearchSourceDto[] {
  return filter === 'all' ? sources : sources.filter((source) => source.selectionStatus === filter)
}

const FILTERS: Array<{ id: ResearchSourceFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'selected', label: '已选择' },
  { id: 'rejected', label: '已拒绝' },
  { id: 'discovered', label: '待筛选' },
]

export function ResearchSourcesPanel({ sources }: { sources: ResearchSourceDto[] }) {
  const [filter, setFilter] = useState<ResearchSourceFilter>('all')
  const visibleSources = filterResearchSources(sources, filter)
  return (
    <section className="research-section" aria-labelledby="research-sources-heading">
      <div className="research-section-heading"><h3 id="research-sources-heading">来源</h3><span>{sources.length} 条</span></div>
      <div className="research-filter-row" aria-label="来源状态筛选">
        {FILTERS.map((option) => <button type="button" key={option.id} className="research-filter" aria-pressed={filter === option.id} onClick={() => setFilter(option.id)}>{option.label}</button>)}
      </div>
      {visibleSources.length > 0 ? <div className="research-source-table" role="table" aria-label="研究来源">
        <div className="research-source-header" role="row"><span role="columnheader">来源</span><span role="columnheader">域名</span><span role="columnheader">状态</span></div>
        {visibleSources.map((source) => <div className="research-source-row" role="row" key={source.id}>
          <a role="cell" href={source.canonicalUrl} target="_blank" rel="noreferrer">{source.title ?? source.canonicalUrl}</a>
          <span role="cell">{source.domain}</span>
          <span role="cell" className="research-status-badge" data-status={source.selectionStatus}>{source.selectionStatus}</span>
        </div>)}
      </div> : <p className="research-empty">没有符合当前筛选条件的来源。</p>}
    </section>
  )
}
