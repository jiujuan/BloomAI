import React, { useState } from 'react'
import { Ellipsis, FolderPlus } from 'lucide-react'
import { useChatStore, usePersonaStore, useProjectStore, useSessionStore } from '@renderer/store'
import { CreateProjectDialog } from './CreateProjectDialog'
import { ProjectTree } from './ProjectTree'
import { RecentSessions } from './RecentSessions'

export function nextExpandedProjectId(current: string | null, selected: string): string | null {
  return current === selected ? null : selected
}

export function ProjectSessionSidebar() {
  const { projects, loading, error } = useProjectStore()
  const { createProjectSession } = useSessionStore()
  const { activePersonaId } = usePersonaStore()
  const { loadMessages } = useChatStore()
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null)
  const [projectListExpanded, setProjectListExpanded] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const createInProject = async (projectId: string) => {
    const session = await createProjectSession(projectId, { persona_id: activePersonaId || undefined })
    await loadMessages(session.id)
    setExpandedProjectId(projectId)
  }

  return <aside className="session-list-panel project-session-sidebar" aria-label="项目和最近聊天">
    <section className="sidebar-section project-sidebar-section" aria-labelledby="projects-title">
      <div className="sidebar-section-title"><h2 id="projects-title">项目</h2><div><button className="sidebar-icon-button" title={projectListExpanded ? '收起文件夹' : '展开文件夹'} aria-label={projectListExpanded ? '收起文件夹' : '展开文件夹'} onClick={() => setProjectListExpanded((value) => !value)}><Ellipsis size={16} /></button><button className="sidebar-icon-button" title="创建项目" aria-label="创建项目" onClick={() => setCreateOpen(true)}><FolderPlus size={16} /></button></div></div>
      {loading && <div className="project-session-skeleton" aria-label="正在加载项目"><span /><span /><span /></div>}
      {error && <div className="sidebar-inline-error" role="alert">{error}<button onClick={() => void useProjectStore.getState().loadProjects()}>重试</button></div>}
      {!loading && !error && <ProjectTree projects={projects} expandedProjectId={expandedProjectId} projectListExpanded={projectListExpanded} onToggleProject={(id) => setExpandedProjectId((active) => nextExpandedProjectId(active, id))} onCreateSession={(id) => void createInProject(id)} onToggleProjectList={() => setProjectListExpanded((value) => !value)} />}
    </section>
    <RecentSessions />
    <CreateProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(projectId) => { setExpandedProjectId(projectId); setProjectListExpanded(true) }} />
  </aside>
}