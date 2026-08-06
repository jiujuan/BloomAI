import React from 'react'
import { Archive, Boxes, FilePlus2, LayoutDashboard, PlayCircle, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@renderer/utils'
import type { SkillsCenterTab } from './SkillsCenterWorkbench'

type SkillsSidebarProps = {
  tab: SkillsCenterTab
  counts: Record<SkillsCenterTab, number>
  onChange: (tab: SkillsCenterTab) => void
}

const items: Array<{ id: SkillsCenterTab; label: string; icon: LucideIcon }> = [
  { id: 'installed', label: 'Installed', icon: LayoutDashboard },
  { id: 'available', label: 'Available / Import', icon: Boxes },
  { id: 'runs', label: 'Runs', icon: PlayCircle },
  { id: 'drafts', label: 'Drafts', icon: FilePlus2 },
]

export function SkillsSidebar({ tab, counts, onChange }: SkillsSidebarProps) {
  return <aside className="skills-center-sidebar" aria-label="Skills Center 导航">
    <div className="skills-center-brand"><span className="skills-center-brand-mark" aria-hidden="true">S</span><span><strong>Skills Center</strong><small>Runtime control plane</small></span></div>
    <div className="skills-center-nav-label">Workspace</div>
    <nav aria-label="Skills Center 页面">
      {items.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={cn('skills-center-nav-item', tab === id && 'active')} aria-current={tab === id ? 'page' : undefined} onClick={() => onChange(id)}>
        <Icon size={16} aria-hidden="true" /><span>{label}</span><span className="skills-center-nav-count" aria-label={`${label} 数量`}>{counts[id]}</span>
      </button>)}
    </nav>
    <div className="skills-center-nav-label">Create</div>
    <button type="button" className={cn('skills-center-nav-item', tab === 'creator' && 'active')} aria-current={tab === 'creator' ? 'page' : undefined} onClick={() => onChange('creator')}>
      <Sparkles size={16} aria-hidden="true" /><span>Skills Creator</span><span className="skills-center-nav-count">+</span>
    </button>
    <div className="skills-center-sidebar-note"><Archive size={14} aria-hidden="true" /><span>Legacy 与 Package 分开执行，危险操作会显示影响摘要。</span></div>
  </aside>
}
