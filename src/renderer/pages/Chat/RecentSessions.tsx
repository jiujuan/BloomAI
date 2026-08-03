import React, { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useChatStore, usePersonaStore, useSessionStore } from '@renderer/store'
import { SessionRow } from './SessionRow'
import { SidebarSectionHeader } from './SidebarSectionHeader'
import { nextRecentVisibleCount } from './project-sidebar.utils'

export function shouldShowRecentMore(visibleCount: number, total: number): boolean {
  return total > visibleCount
}

export function RecentSessions() {
  const { sessions, recentSessionIds, recentTotal, recentVisibleCount, recentLoading, recentError, loadRecentSessions, createSession, activeSessionId, setActiveSession } = useSessionStore()
  const { activePersonaId } = usePersonaStore()
  const { loadMessages } = useChatStore()
  const [recentSectionExpanded, setRecentSectionExpanded] = useState(true)
  const byId = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions])
  const createRegularSession = async () => { const session = await createSession({ persona_id: activePersonaId || undefined }); await loadMessages(session.id) }
  const nextLimit = nextRecentVisibleCount(recentVisibleCount, recentTotal)

  return <section className={`sidebar-section recent-sessions-section${recentSectionExpanded ? '' : ' is-collapsed'}`} aria-labelledby="recent-sessions-title">
    <SidebarSectionHeader
      title="最近"
      titleId="recent-sessions-title"
      expanded={recentSectionExpanded}
      onToggle={() => setRecentSectionExpanded((value) => !value)}
      actions={<button className="sidebar-icon-button" type="button" aria-label="新建普通聊天" title="新建普通聊天" onClick={() => void createRegularSession()}><Plus size={15} /></button>}
    />
    {recentSectionExpanded && <div id="recent-sessions-title-content" className="sidebar-section-content">
      {recentLoading && recentSessionIds.length === 0 && <div className="project-session-skeleton" aria-label="正在加载最近聊天"><span /><span /><span /></div>}
      {recentError && <div className="sidebar-inline-error" role="alert">{recentError}<button type="button" onClick={() => void loadRecentSessions({ replace: true, limit: 15 })}>重试</button></div>}
      {!recentLoading && !recentError && recentSessionIds.length === 0 && <div className="session-empty"><p>暂无普通聊天</p><button type="button" className="btn-primary-sm" onClick={() => void createRegularSession()}>新建聊天</button></div>}
      <div role="list">{recentSessionIds.map((id) => { const session = byId.get(id); return session && <SessionRow key={id} session={session} isActive={activeSessionId === id} onSelect={async () => { setActiveSession(id); await loadMessages(id) }} /> })}</div>
      {shouldShowRecentMore(recentVisibleCount, recentTotal) && <button className="sidebar-more-button" type="button" disabled={recentLoading} onClick={() => void loadRecentSessions({ limit: nextLimit })}>{recentLoading ? '加载中...' : '更多'}</button>}
    </div>}
  </section>
}
