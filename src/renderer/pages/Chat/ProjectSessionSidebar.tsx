import React, { useState } from 'react'
import { useChatStore, usePersonaStore, useProjectStore, useSessionStore, useUIStore } from '@renderer/store'
import { CreateProjectDialog } from './CreateProjectDialog'
import { ProjectTree } from './ProjectTree'
import { RecentSessions } from './RecentSessions'
import { SidebarSectionHeader } from './SidebarSectionHeader'

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

export function ProjectSessionSidebar({
  createProjectOpen,
  onCreateProjectOpenChange,
}: {
  createProjectOpen: boolean
  onCreateProjectOpenChange: (open: boolean) => void
}) {
  const { projects, loading, error } = useProjectStore()
  const { createProjectSession } = useSessionStore()
  const { activePersonaId } = usePersonaStore()
  const { loadMessages } = useChatStore()
  const { setPage } = useUIStore()
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(() => new Set())
  const [projectListExpanded, setProjectListExpanded] = useState(false)
  const [projectsSectionExpanded, setProjectsSectionExpanded] = useState(true)
  const [recentSectionExpanded, setRecentSectionExpanded] = useState(true)

  const createInProject = async (projectId: string) => {
    setPage('chat')
    const session = await createProjectSession(projectId, { persona_id: activePersonaId || undefined })
    await loadMessages(session.id)
    setExpandedProjectIds((current) => expandProjectId(current, projectId))
  }

  return (
    <div className="workspace-sidebar-content" aria-label="聊天和项目">
      <section className="workspace-section" aria-labelledby="projects-title">
        <SidebarSectionHeader
          title={`项目 (${projects.length})`}
          titleId="projects-title"
          expanded={projectsSectionExpanded}
          onToggle={() => setProjectsSectionExpanded((value) => !value)}
        />
        {projectsSectionExpanded && (
          <div id="projects-title-content" className="workspace-section-content">
            {loading && <div className="project-session-skeleton" aria-label="正在加载项目"><span /><span /><span /></div>}
            {error && <div className="sidebar-inline-error" role="alert">{error}<button type="button" onClick={() => void useProjectStore.getState().loadProjects()}>重试</button></div>}
            {!loading && !error && (
              <ProjectTree
                projects={projects}
                expandedProjectIds={expandedProjectIds}
                projectListExpanded={projectListExpanded}
                onToggleProject={(id) => setExpandedProjectIds((current) => toggleExpandedProjectId(current, id))}
                onCreateSession={(id) => void createInProject(id)}
                onToggleProjectList={() => setProjectListExpanded((value) => !value)}
              />
            )}
          </div>
        )}
      </section>

      <section className="workspace-section" aria-labelledby="recent-sessions-title">
        <RecentSessions
          expanded={recentSectionExpanded}
          onToggle={() => setRecentSectionExpanded((value) => !value)}
        />
      </section>

      <CreateProjectDialog
        open={createProjectOpen}
        onClose={() => onCreateProjectOpenChange(false)}
        onCreated={(projectId) => {
          setExpandedProjectIds((current) => expandProjectId(current, projectId))
          setProjectListExpanded(true)
          setProjectsSectionExpanded(true)
          onCreateProjectOpenChange(false)
        }}
      />
    </div>
  )
}
