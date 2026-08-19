import React, { useMemo } from 'react'
import { useChatStore, usePersonaStore, useSessionStore, useUIStore } from '@renderer/store'
import { SessionRow } from './SessionRow'
import { SidebarSectionHeader } from './SidebarSectionHeader'
import { nextRecentVisibleCount } from './project-sidebar.utils'

export function shouldShowRecentMore(visibleCount: number, total: number): boolean {
  return total > visibleCount
}

export function recentSectionTitle(total: number): string {
  return `聊天 (${total})`
}

export function RecentSessions({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const { sessions, recentSessionIds, recentTotal, recentVisibleCount, recentLoading, recentError, loadRecentSessions, createSession, activeSessionId, setActiveSession } = useSessionStore()
  const { activePersonaId } = usePersonaStore()
  const { loadMessages } = useChatStore()
  const { setPage } = useUIStore()
  const byId = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions])
  const createRegularSession = async () => {
    setPage('chat')
    const session = await createSession({ persona_id: activePersonaId || undefined })
    await loadMessages(session.id)
  }
  const selectSession = async (id: string) => {
    setPage('chat')
    setActiveSession(id)
    await loadMessages(id)
  }
  const nextLimit = nextRecentVisibleCount(recentVisibleCount, recentTotal)

  return <>
    <SidebarSectionHeader
      title={recentSectionTitle(recentTotal)}
      titleId="recent-sessions-title"
      expanded={expanded}
      onToggle={onToggle}
    />
    {expanded && <div id="recent-sessions-title-content" className="workspace-section-content">
      {recentLoading && recentSessionIds.length === 0 && <div className="project-session-skeleton" aria-label="正在加载最近聊天"><span /><span /><span /></div>}
      {recentError && <div className="sidebar-inline-error" role="alert">{recentError}<button type="button" onClick={() => void loadRecentSessions({ replace: true, limit: 15 })}>重试</button></div>}
      {!recentLoading && !recentError && recentSessionIds.length === 0 && <div className="session-empty"><p>暂无普通聊天</p><button type="button" className="btn-primary-sm" onClick={() => void createRegularSession()}>新建聊天</button></div>}
      <div role="list">{recentSessionIds.map((id) => { const session = byId.get(id); return session && <SessionRow key={id} session={session} isActive={activeSessionId === id} onSelect={() => selectSession(id)} /> })}</div>
      {shouldShowRecentMore(recentVisibleCount, recentTotal) && <button className="sidebar-more-button" type="button" disabled={recentLoading} onClick={() => void loadRecentSessions({ limit: nextLimit })}>{recentLoading ? '加载中...' : '更多'}</button>}
    </div>}
  </>
}
