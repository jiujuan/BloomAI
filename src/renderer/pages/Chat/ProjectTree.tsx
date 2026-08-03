import React from 'react'
import { Folder, FolderOpen, Plus } from 'lucide-react'
import type { ProjectSummary } from '@shared/schemas'
import { ProjectSessions } from './ProjectSessions'
import { visibleProjectCount } from './project-sidebar.utils'

export function ProjectTree({ projects, expandedProjectIds, projectListExpanded, onToggleProject, onCreateSession, onToggleProjectList }: {
  projects: ProjectSummary[]
  expandedProjectIds: ReadonlySet<string>
  projectListExpanded: boolean
  onToggleProject: (projectId: string) => void
  onCreateSession: (projectId: string) => void
  onToggleProjectList: () => void
}) {
  const visible = projects.slice(0, visibleProjectCount(projects.length, projectListExpanded))
  return <>
    {visible.map((project) => {
      const expanded = expandedProjectIds.has(project.id)
      return <div key={project.id} className="project-tree-item">
        <div className="project-row-wrap">
          <button className="project-row" aria-expanded={expanded} aria-label={`${project.name}，${project.sessionCount} 个聊天`} onClick={() => onToggleProject(project.id)}>
            {expanded ? <FolderOpen size={15} /> : <Folder size={15} />}<span className="project-row-name">{project.name}</span><span className="project-row-count">{project.sessionCount}</span>
          </button>
          <button className="project-new-session" aria-label={`在 ${project.name} 中新建聊天`} title="在此项目中新建聊天" onClick={() => onCreateSession(project.id)}><Plus size={14} /></button>
        </div>
        <ProjectSessions projectId={project.id} expanded={expanded} />
      </div>
    })}
    {projects.length === 0 && <div className="session-empty"><p>还没有项目</p></div>}
    {projects.length > 6 && <button className="sidebar-more-button" onClick={onToggleProjectList}>{projectListExpanded ? '收起文件夹' : '更多文件夹'}</button>}
  </>
}
