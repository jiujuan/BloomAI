import React, { useRef, useState } from 'react'
import { FolderPlus } from 'lucide-react'
import { useChatStore, usePersonaStore, useProjectStore, useSessionStore } from '@renderer/store'
import { CreateProjectDialog } from './CreateProjectDialog'
import { ProjectTree } from './ProjectTree'
import { RecentSessions } from './RecentSessions'
import { SidebarSectionHeader } from './SidebarSectionHeader'

const PROJECT_SECTION_MIN_RATIO = 0.2
const PROJECT_SECTION_MAX_RATIO = 0.8

export function toggleExpandedProjectId(current: ReadonlySet<string>, selected: string): Set<string> {
  const next = new Set(current)
  if (next.has(selected)) {
    next.delete(selected)
  } else {
    next.add(selected)
  }
  return next
}

export function expandProjectId(current: ReadonlySet<string>, selected: string): Set<string> {
  const next = new Set(current)
  next.add(selected)
  return next
}

export function clampProjectSectionRatio(ratio: number): number {
  return Math.min(PROJECT_SECTION_MAX_RATIO, Math.max(PROJECT_SECTION_MIN_RATIO, ratio))
}

export function projectSectionRatioFromPointer(clientY: number, projectTop: number, projectHeight: number, recentHeight: number, resizerHeight: number): number {
  const availableHeight = Math.max(projectHeight + recentHeight, 1)
  const projectHeightFromPointer = clientY - projectTop - resizerHeight / 2
  return clampProjectSectionRatio(projectHeightFromPointer / availableHeight)
}

export function ProjectSessionSidebar() {
  const { projects, loading, error } = useProjectStore()
  const { createProjectSession } = useSessionStore()
  const { activePersonaId } = usePersonaStore()
  const { loadMessages } = useChatStore()
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(() => new Set())
  const [projectListExpanded, setProjectListExpanded] = useState(false)
  const [projectsSectionExpanded, setProjectsSectionExpanded] = useState(true)
  const [recentSectionExpanded, setRecentSectionExpanded] = useState(true)
  const [projectSectionRatio, setProjectSectionRatio] = useState(0.5)
  const [isResizing, setIsResizing] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const sidebarRef = useRef<HTMLElement>(null)
  const projectSectionRef = useRef<HTMLElement>(null)
  const recentSectionRef = useRef<HTMLElement>(null)
  const resizerRef = useRef<HTMLDivElement>(null)

  const createInProject = async (projectId: string) => {
    const session = await createProjectSession(projectId, { persona_id: activePersonaId || undefined })
    await loadMessages(session.id)
    setExpandedProjectIds((current) => expandProjectId(current, projectId))
  }

  const canResizeSections = projectsSectionExpanded && recentSectionExpanded

  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!canResizeSections || (event.pointerType === 'mouse' && event.button !== 0)) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsResizing(true)
  }

  const handleResizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isResizing || !canResizeSections) return
    const projectSection = projectSectionRef.current?.getBoundingClientRect()
    const recentSection = recentSectionRef.current?.getBoundingClientRect()
    const resizer = resizerRef.current?.getBoundingClientRect()
    if (!projectSection || !recentSection || !resizer) return
    setProjectSectionRatio(projectSectionRatioFromPointer(
      event.clientY,
      projectSection.top,
      projectSection.height,
      recentSection.height,
      resizer.height,
    ))
  }

  const handleResizeEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setIsResizing(false)
  }

  const handleResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!canResizeSections) return
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setProjectSectionRatio((ratio) => clampProjectSectionRatio(ratio - 0.05))
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setProjectSectionRatio((ratio) => clampProjectSectionRatio(ratio + 0.05))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setProjectSectionRatio(PROJECT_SECTION_MIN_RATIO)
    } else if (event.key === 'End') {
      event.preventDefault()
      setProjectSectionRatio(PROJECT_SECTION_MAX_RATIO)
    }
  }

  return <aside ref={sidebarRef} className={`session-list-panel project-session-sidebar${isResizing ? ' is-resizing' : ''}`} aria-label="项目和最近聊天">
    <section
      ref={projectSectionRef}
      className={`sidebar-section project-sidebar-section${projectsSectionExpanded ? '' : ' is-collapsed'}`}
      style={projectsSectionExpanded ? { flex: `${projectSectionRatio} 1 0` } : undefined}
      aria-labelledby="projects-title"
    >
      <SidebarSectionHeader
        title="项目"
        titleId="projects-title"
        expanded={projectsSectionExpanded}
        onToggle={() => setProjectsSectionExpanded((value) => !value)}
        actions={<button className="sidebar-icon-button" type="button" title="创建项目" aria-label="创建项目" onClick={() => setCreateOpen(true)}><FolderPlus size={16} /></button>}
      />
      {projectsSectionExpanded && <div id="projects-title-content" className="sidebar-section-content">
        {loading && <div className="project-session-skeleton" aria-label="正在加载项目"><span /><span /><span /></div>}
        {error && <div className="sidebar-inline-error" role="alert">{error}<button type="button" onClick={() => void useProjectStore.getState().loadProjects()}>重试</button></div>}
        {!loading && !error && <ProjectTree projects={projects} expandedProjectIds={expandedProjectIds} projectListExpanded={projectListExpanded} onToggleProject={(id) => setExpandedProjectIds((current) => toggleExpandedProjectId(current, id))} onCreateSession={(id) => void createInProject(id)} onToggleProjectList={() => setProjectListExpanded((value) => !value)} />}
      </div>}
    </section>
    <div
      ref={resizerRef}
      className="sidebar-section-resizer"
      role="separator"
      aria-orientation="horizontal"
      aria-label="调整项目和最近聊天区域高度"
      aria-disabled={!canResizeSections}
      aria-valuemin={PROJECT_SECTION_MIN_RATIO * 100}
      aria-valuemax={PROJECT_SECTION_MAX_RATIO * 100}
      aria-valuenow={Math.round(projectSectionRatio * 100)}
      tabIndex={canResizeSections ? 0 : -1}
      onPointerDown={handleResizeStart}
      onPointerMove={handleResizeMove}
      onPointerUp={handleResizeEnd}
      onPointerCancel={handleResizeEnd}
      onKeyDown={handleResizeKeyDown}
    />
    <section
      ref={recentSectionRef}
      className={`sidebar-section recent-sessions-section${recentSectionExpanded ? '' : ' is-collapsed'}`}
      style={recentSectionExpanded ? { flex: `${1 - projectSectionRatio} 1 0` } : undefined}
      aria-labelledby="recent-sessions-title"
    >
      <RecentSessions
        expanded={recentSectionExpanded}
        onToggle={() => setRecentSectionExpanded((value) => !value)}
      />
    </section>
    <CreateProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(projectId) => { setExpandedProjectIds((current) => expandProjectId(current, projectId)); setProjectListExpanded(true); setProjectsSectionExpanded(true) }} />
  </aside>
}
