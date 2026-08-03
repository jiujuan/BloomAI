import React from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

export function SidebarSectionHeader({
  title,
  titleId,
  expanded,
  onToggle,
  actions,
}: {
  title: string
  titleId: string
  expanded: boolean
  onToggle: () => void
  actions?: React.ReactNode
}) {
  const Icon = expanded ? ChevronDown : ChevronRight

  return <div className="sidebar-section-title">
    <h2 id={titleId}>
      <button
        className="sidebar-section-toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={`${titleId}-content`}
        aria-label={`${expanded ? '收起' : '展开'}${title}`}
        onClick={onToggle}
      >
        <Icon size={14} aria-hidden="true" />
        <span>{title}</span>
      </button>
    </h2>
    {actions && <div className="sidebar-section-actions">{actions}</div>}
  </div>
}
