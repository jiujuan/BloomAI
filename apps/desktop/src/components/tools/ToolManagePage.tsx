import React, { useEffect, useState } from 'react'
import { Search, History } from 'lucide-react'
import { useToolsStore } from '../../stores/tools.store'
import { cn } from '../../lib/utils'

const CATEGORY_ICON: Record<string, string> = { web: '🌐', fs: '📁', document: '📄', multimodal: '🖼️', execution: '⚡' }
const CATEGORY_LABEL: Record<string, string> = { web: 'Web', fs: 'File System', document: 'Document', multimodal: 'Multimodal', execution: 'Execution' }

export function ToolManagePage({ onOpenDetail }: { onOpenDetail: (id: string) => void }) {
  const { tools, stats, loadTools, loadStats, setEnabled } = useToolsStore()
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')

  useEffect(() => { loadTools(); loadStats() }, [])

  const filtered = tools.filter(t => {
    if (category !== 'all' && t.category !== category) return false
    if (query && !t.name.toLowerCase().includes(query.toLowerCase()) && !t.id.includes(query.toLowerCase())) return false
    return true
  })

  const grouped: Record<string, typeof tools> = {}
  for (const t of filtered) { if (!grouped[t.category]) grouped[t.category] = []; grouped[t.category].push(t) }
  const categories = ['all', 'web', 'fs', 'document', 'multimodal', 'execution']

  return (
    <div className="tools-page">
      <div className="tools-topbar">
        <span className="tools-title">🔧 Tool Management</span>
        <div className="tools-search">
          <Search size={13} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tools…" />
        </div>
        <button className="tools-tbtn"><History size={13} /> Run History</button>
      </div>

      <div className="tools-stats-row">
        <div className="tools-stat"><div className="ts-label">Total Tools</div><div className="ts-val">{stats.total || 0}</div></div>
        <div className="tools-stat"><div className="ts-label">Enabled</div><div className="ts-val ok">{stats.enabled || 0}</div></div>
        <div className="tools-stat"><div className="ts-label">Today's Calls</div><div className="ts-val">{stats.todayCalls || 0}</div></div>
        <div className="tools-stat"><div className="ts-label">Errors</div><div className="ts-val danger">{stats.errors || 0}</div></div>
        <div className="tools-stat"><div className="ts-label">Avg Duration</div><div className="ts-val">{stats.avgDurationMs || 0}ms</div></div>
      </div>

      <div className="tools-chips">
        {categories.map(c => (
          <button key={c} className={cn('tools-chip', category === c && 'on')} onClick={() => setCategory(c)}>
            {c === 'all' ? 'All' : CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>

      <div className="tools-body">
        {Object.entries(grouped).map(([cat, items]) => (
          <div key={cat} className="tools-cat-block">
            <div className="tools-cat-head">
              <span className="tools-cat-icon">{CATEGORY_ICON[cat]}</span>
              <span className="tools-cat-name">{CATEGORY_LABEL[cat]}</span>
              <span className="tools-cat-count">{items.length}</span>
            </div>
            <div className="tools-grid">
              {items.map(tool => (
                <div key={tool.id} className="tool-row" onClick={() => onOpenDetail(tool.id)}>
                  <div className="tool-row-ic">{CATEGORY_ICON[tool.category]}</div>
                  <div className="tool-row-info">
                    <div className="tool-row-name">{tool.id}</div>
                    <div className="tool-row-meta">
                      {tool.requires_permission && (
                        <span className={cn('perm-badge', tool.requires_permission === 'shell' ? 'danger' : 'info')}>{tool.requires_permission}</span>
                      )}
                    </div>
                  </div>
                  <div className="tool-row-right" onClick={e => e.stopPropagation()}>
                    <div className={cn('status-dot', tool.is_enabled ? 'ok' : 'off')} />
                    <button className={cn('tool-toggle', tool.is_enabled && 'on')} onClick={() => setEnabled(tool.id, !tool.is_enabled)} role="switch" aria-checked={!!tool.is_enabled}>
                      <span className="tool-toggle-knob" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div className="tools-empty">No tools match your search</div>}
      </div>
    </div>
  )
}
