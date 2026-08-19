import React, { useEffect, useRef, useState } from 'react'
import {
  BookImage,
  CalendarClock,
  FolderPlus,
  Image,
  MoreHorizontal,
  PlusCircle,
  Puzzle,
  ServerCog,
  Settings,
  User,
  Wrench,
} from 'lucide-react'
import { useChatStore, usePersonaStore, useSessionStore, useUIStore } from '@renderer/store'
import { cn } from '@renderer/utils'
import { ProjectSessionSidebar } from '@renderer/pages/Chat/ProjectSessionSidebar'

type WorkspacePage = 'chat' | 'settings' | 'personas' | 'tools' | 'skills' | 'schedules' | 'image' | 'article-illustration' | 'mcp-servers'

export const DEFAULT_WORKSPACE_SIDEBAR_WIDTH = 300
export const MIN_WORKSPACE_SIDEBAR_WIDTH = 220
export const MAX_WORKSPACE_SIDEBAR_WIDTH = 480

const WORKSPACE_SIDEBAR_KEYBOARD_STEP = 16
const WORKSPACE_SIDEBAR_LARGE_KEYBOARD_STEP = 40

export function clampWorkspaceSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_WORKSPACE_SIDEBAR_WIDTH
  return Math.min(Math.max(width, MIN_WORKSPACE_SIDEBAR_WIDTH), MAX_WORKSPACE_SIDEBAR_WIDTH)
}

export function getWorkspaceSidebarWidthFromPointer(startWidth: number, startX: number, currentX: number): number {
  return clampWorkspaceSidebarWidth(startWidth + currentX - startX)
}

export const workspaceNavigationItems = [
  { id: 'new-chat', label: '新建聊天', icon: PlusCircle, kind: 'action' as const },
  { id: 'project', label: '项目', icon: FolderPlus, kind: 'action' as const },
  { id: 'skills', label: '技能', icon: Puzzle, page: 'skills' as const, kind: 'page' as const },
  { id: 'image', label: 'AI 画图', icon: Image, page: 'image' as const, kind: 'page' as const },
  { id: 'schedules', label: '定时任务', icon: CalendarClock, page: 'schedules' as const, kind: 'page' as const },
  { id: 'more', label: '更多...', icon: MoreHorizontal, kind: 'menu' as const },
] as const

export const moreNavigationItems = [
  { id: 'mcp-servers', label: 'MCP Servers', icon: ServerCog, page: 'mcp-servers' as const },
  { id: 'article-illustration', label: '文章配图', icon: BookImage, page: 'article-illustration' as const },
  { id: 'personas', label: 'Personas', icon: User, page: 'personas' as const },
  { id: 'tools', label: 'Tools', icon: Wrench, page: 'tools' as const },
] as const

function isMorePageActive(activePage: WorkspacePage): boolean {
  return moreNavigationItems.some((item) => item.page === activePage)
}

export function WorkspaceSidebar() {
  const { activePage, setPage } = useUIStore()
  const { createSession } = useSessionStore()
  const { activePersonaId } = usePersonaStore()
  const { loadMessages } = useChatStore()
  const [moreOpen, setMoreOpen] = useState(false)
  const [createProjectOpen, setCreateProjectOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WORKSPACE_SIDEBAR_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const moreRegionRef = useRef<HTMLDivElement>(null)
  const moreTriggerRef = useRef<HTMLButtonElement>(null)
  const resizeStartRef = useRef<{ startX: number; startWidth: number; pointerId: number } | null>(null)

  useEffect(() => {
    if (!isResizing) return

    const handlePointerMove = (event: PointerEvent) => {
      const resizeStart = resizeStartRef.current
      if (!resizeStart || resizeStart.pointerId !== event.pointerId) return
      setSidebarWidth(getWorkspaceSidebarWidthFromPointer(resizeStart.startWidth, resizeStart.startX, event.clientX))
    }
    const stopResizing = (event: PointerEvent) => {
      const resizeStart = resizeStartRef.current
      if (!resizeStart || resizeStart.pointerId !== event.pointerId) return
      resizeStartRef.current = null
      setIsResizing(false)
    }
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)
    window.addEventListener('pointercancel', stopResizing)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
      window.removeEventListener('pointercancel', stopResizing)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }
  }, [isResizing])

  useEffect(() => {
    if (!moreOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!moreRegionRef.current?.contains(event.target as Node)) setMoreOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMoreOpen(false)
        moreTriggerRef.current?.focus()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [moreOpen])

  const createRegularSession = async () => {
    setPage('chat')
    const session = await createSession({ persona_id: activePersonaId || undefined })
    await loadMessages(session.id)
  }

  const handleNavigation = (item: (typeof workspaceNavigationItems)[number]) => {
    if (item.kind === 'action') {
      if (item.id === 'new-chat') void createRegularSession()
      if (item.id === 'project') setCreateProjectOpen(true)
      return
    }
    if (item.kind === 'page') setPage(item.page)
    if (item.kind === 'menu') setMoreOpen((value) => !value)
  }

  const handleMoreBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMoreOpen(false)
  }

  const handleResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    resizeStartRef.current = { startX: event.clientX, startWidth: sidebarWidth, pointerId: event.pointerId }
    setIsResizing(true)
  }

  const handleResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? WORKSPACE_SIDEBAR_LARGE_KEYBOARD_STEP : WORKSPACE_SIDEBAR_KEYBOARD_STEP
    let nextWidth: number | undefined

    if (event.key === 'ArrowLeft') nextWidth = clampWorkspaceSidebarWidth(sidebarWidth - step)
    if (event.key === 'ArrowRight') nextWidth = clampWorkspaceSidebarWidth(sidebarWidth + step)
    if (event.key === 'Home') nextWidth = MIN_WORKSPACE_SIDEBAR_WIDTH
    if (event.key === 'End') nextWidth = MAX_WORKSPACE_SIDEBAR_WIDTH
    if (nextWidth === undefined || nextWidth === sidebarWidth) return

    event.preventDefault()
    setSidebarWidth(nextWidth)
  }

  return (
    <aside
      className={cn('workspace-sidebar', isResizing && 'is-resizing')}
      style={{ width: sidebarWidth, minWidth: sidebarWidth, flexBasis: sidebarWidth }}
      aria-label="工作区侧栏"
    >
      <nav className="workspace-sidebar-navigation" aria-label="工作区快捷入口">
        {workspaceNavigationItems.map((item) => {
          const Icon = item.icon
          const active = item.kind === 'page'
            ? activePage === item.page
            : item.kind === 'menu' && isMorePageActive(activePage)
          const isMore = item.kind === 'menu'

          if (isMore) {
            return (
              <div
                key={item.id}
                ref={moreRegionRef}
                className="workspace-more-region"
                onMouseEnter={() => setMoreOpen(true)}
                onMouseLeave={() => setMoreOpen(false)}
                onFocus={() => setMoreOpen(true)}
                onBlur={handleMoreBlur}
              >
                <button
                  ref={moreTriggerRef}
                  type="button"
                  className={cn('workspace-nav-item', active && 'active')}
                  onClick={() => handleNavigation(item)}
                  aria-label={item.label}
                  aria-expanded={moreOpen}
                  aria-haspopup="menu"
                >
                  <span className="workspace-nav-item-icon"><Icon size={18} strokeWidth={1.8} /></span>
                  <span>{item.label}</span>
                </button>
                {moreOpen && (
                  <div className="workspace-more-menu" role="menu" aria-label="更多工具">
                    {moreNavigationItems.map((moreItem) => {
                      const MoreIcon = moreItem.icon
                      return (
                        <button
                          key={moreItem.id}
                          type="button"
                          className="workspace-more-menu-item"
                          role="menuitem"
                          onClick={() => {
                            setPage(moreItem.page)
                            setMoreOpen(false)
                          }}
                        >
                          <span className="workspace-more-menu-icon"><MoreIcon size={16} strokeWidth={1.8} /></span>
                          <span>{moreItem.label}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          }

          return (
            <button
              key={item.id}
              type="button"
              className={cn('workspace-nav-item', active && 'active')}
              onClick={() => handleNavigation(item)}
              aria-label={item.id === 'project' ? '新建项目' : item.label}
              aria-current={item.kind === 'page' && active ? 'page' : undefined}
              title={item.id === 'project' ? '新建项目' : item.label}
            >
              <span className="workspace-nav-item-icon"><Icon size={18} strokeWidth={1.8} /></span>
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      <ProjectSessionSidebar
        createProjectOpen={createProjectOpen}
        onCreateProjectOpenChange={setCreateProjectOpen}
      />

      <div className="workspace-sidebar-settings">
        <button
          type="button"
          className={cn('workspace-nav-item', activePage === 'settings' && 'active')}
          onClick={() => setPage('settings')}
          aria-label="设置"
          aria-current={activePage === 'settings' ? 'page' : undefined}
        >
          <span className="workspace-nav-item-icon"><Settings size={18} strokeWidth={1.8} /></span>
          <span>设置</span>
        </button>
      </div>

      <div
        className="workspace-sidebar-resizer"
        role="separator"
        aria-label="调整工作区侧栏宽度"
        aria-orientation="vertical"
        aria-valuemin={MIN_WORKSPACE_SIDEBAR_WIDTH}
        aria-valuemax={MAX_WORKSPACE_SIDEBAR_WIDTH}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        onPointerDown={handleResizePointerDown}
        onKeyDown={handleResizeKeyDown}
      />
    </aside>
  )
}
