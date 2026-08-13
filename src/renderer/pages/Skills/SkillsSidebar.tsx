import React from 'react'
import { Archive, FileSearch, LayoutDashboard, PackageOpen, PlayCircle, Settings2, Sparkles, Upload } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@renderer/utils'

export type SkillsRuntimeView = 'center' | 'import' | 'creator' | 'detail' | 'runs' | 'artifacts' | 'settings'
export type SkillsCenterTab = SkillsRuntimeView

export type SkillsRuntimeNavItem = {
  id: SkillsRuntimeView
  label: string
  icon: LucideIcon
  group: 'workspace' | 'create' | 'system'
}

export const SKILLS_RUNTIME_NAV_ITEMS: SkillsRuntimeNavItem[] = [
  { id: 'center', label: 'Skills Center', icon: LayoutDashboard, group: 'workspace' },
  { id: 'import', label: '导入 Skill', icon: Upload, group: 'workspace' },
  { id: 'creator', label: 'Skills Creator', icon: Sparkles, group: 'create' },
  { id: 'detail', label: 'Skill 详情', icon: FileSearch, group: 'workspace' },
  { id: 'runs', label: '运行记录', icon: PlayCircle, group: 'workspace' },
  { id: 'artifacts', label: 'Artifacts', icon: PackageOpen, group: 'workspace' },
  { id: 'settings', label: '系统设置', icon: Settings2, group: 'system' },
]

export function normalizeSkillsView(view: SkillsCenterTab | undefined): SkillsRuntimeView {
  return view || 'center'
}

export function getSkillsBreadcrumb(view: SkillsRuntimeView): string[] {
  const item = SKILLS_RUNTIME_NAV_ITEMS.find((candidate) => candidate.id === view)
  if (!item || view === 'center') return ['Skills Center']
  if (view === 'detail' || view === 'artifacts') return ['Skills Center', 'Skill 详情', item.label]
  return ['Skills Center', item.label]
}

type SkillsSidebarProps = {
  view?: SkillsRuntimeView
  counts: Partial<Record<SkillsRuntimeView, number>> & Record<string, number>
  onChange: (view: SkillsRuntimeView) => void
}

export function SkillsSidebar({ view, counts, onChange }: SkillsSidebarProps) {
  const activeView = normalizeSkillsView(view)
  return <aside className="skills-center-sidebar" aria-label="Skills Runtime 导航">
    <div className="skills-center-brand"><span className="skills-center-brand-mark" aria-hidden="true">S</span><span><strong>Skills Center</strong><small>Package Runtime control plane</small></span></div>
    <div className="skills-center-nav-context"><span className="skills-runtime-context-dot" aria-hidden="true" />Runtime Healthy <span>· Worker</span></div>
    <div className="skills-center-nav-label">Workspace</div>
    <nav aria-label="Skills Runtime 页面">
      {SKILLS_RUNTIME_NAV_ITEMS.filter((item) => item.group === 'workspace').map((item) => <NavItem key={item.id} item={item} activeView={activeView} counts={counts} onChange={onChange} />)}
    </nav>
    <div className="skills-center-nav-label">Create</div>
    <nav aria-label="Skills Creator 页面">
      {SKILLS_RUNTIME_NAV_ITEMS.filter((item) => item.group === 'create').map((item) => <NavItem key={item.id} item={item} activeView={activeView} counts={counts} onChange={onChange} />)}
    </nav>
    <div className="skills-center-nav-label">System</div>
    <nav aria-label="Skills Runtime 系统页面">
      {SKILLS_RUNTIME_NAV_ITEMS.filter((item) => item.group === 'system').map((item) => <NavItem key={item.id} item={item} activeView={activeView} counts={counts} onChange={onChange} />)}
    </nav>
    <div className="skills-center-sidebar-note"><Archive size={14} aria-hidden="true" /><span>所有视图共享 Package、Version、Installation、Run 和审计上下文。</span></div>
  </aside>
}

function NavItem({ item, activeView, counts, onChange }: { item: SkillsRuntimeNavItem; activeView: SkillsRuntimeView; counts: Record<string, number>; onChange: (view: SkillsRuntimeView) => void }) {
  const count = counts[item.id] ?? 0
  return <button type="button" title={item.label} className={cn('skills-center-nav-item', activeView === item.id && 'active')} aria-current={activeView === item.id ? 'page' : undefined} onClick={() => onChange(item.id)}>
    <item.icon size={16} aria-hidden="true" /><span>{item.label}</span><span className="skills-center-nav-count" aria-label={`${item.label} 数量`}>{count}</span>
  </button>
}
