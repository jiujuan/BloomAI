import React, { useEffect, useMemo } from 'react'
import { useChatStore, useProjectStore, useSessionStore, useUIStore } from '@renderer/store'
import { SessionRow } from './SessionRow'
import { shouldShowProjectSessionsMore } from './project-sidebar.utils'

export function projectSessionsDisplayAction(total: number, cachedCount: number): 'expand' | 'collapse' | null {
  if (total > 10 && cachedCount >= total) return 'collapse'
  return shouldShowProjectSessionsMore(total, false) ? 'expand' : null
}

export function ProjectSessions({ projectId, expanded }: { projectId: string; expanded: boolean }) {
  const { sessionIdsByProject, sessionTotalsByProject, projectSessionsLoading, projectSessionsError, loadProjectSessions } = useProjectStore()
  const { sessions, activeSessionId, setActiveSession } = useSessionStore()
  const { loadMessages } = useChatStore()
  const { setPage } = useUIStore()
  const ids = sessionIdsByProject[projectId] ?? []
  const total = sessionTotalsByProject[projectId] ?? 0
  const loading = projectSessionsLoading[projectId]
  const error = projectSessionsError[projectId]
  const displayAction = projectSessionsDisplayAction(total, ids.length)
  const byId = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions])

  useEffect(() => {
    if (expanded && ids.length === 0 && !loading) void loadProjectSessions(projectId, { limit: 10, replace: true })
  }, [expanded, ids.length, loading, loadProjectSessions, projectId])

  if (!expanded) return null
  if (loading && ids.length === 0) return <div className="project-session-skeleton" aria-label="正在加载项目聊天"><span /><span /><span /></div>
  if (error) return <div className="sidebar-inline-error" role="alert">{error}<button onClick={() => void loadProjectSessions(projectId, { limit: 10, replace: true })}>重试</button></div>

  return <div className="project-sessions" role="list">
    {ids.map((id) => {
      const session = byId.get(id)
      return session && <SessionRow key={id} session={session} isActive={activeSessionId === id} onSelect={async () => { setPage('chat'); setActiveSession(id); await loadMessages(id) }} />
    })}
    {displayAction === 'expand' && <button className="sidebar-more-button" onClick={() => void loadProjectSessions(projectId, { limit: 'all', replace: true })}>展开显示</button>}
    {displayAction === 'collapse' && <button className="sidebar-more-button" onClick={() => void loadProjectSessions(projectId, { limit: 10, replace: true })}>收起显示</button>}
  </div>
}
