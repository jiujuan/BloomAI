import React from 'react'
import { BookImage, Image, MessageCircle, Puzzle, Settings, User, Wrench } from 'lucide-react'
import { useUIStore } from '@renderer/store'
import { cn } from '@renderer/utils'

export const mainNavigationItems = [
  { id: 'chat' as const, icon: MessageCircle, label: 'Chat' },
  { id: 'image' as const, icon: Image, label: 'AI 画图' },
  { id: 'article-illustration' as const, icon: BookImage, label: '文章配图' },
  { id: 'tools' as const, icon: Wrench, label: 'Tools' },
  { id: 'skills' as const, icon: Puzzle, label: 'Skills' },
  { id: 'personas' as const, icon: User, label: 'Personas' },
]

export function NavSidebar() {
  const { activePage, setPage } = useUIStore()

  return (
    <nav className="nav-sidebar" aria-label="Main navigation">
      <div className="nav-logo">
        <span className="nav-logo-text">B</span>
      </div>
      <div className="nav-items">
        {mainNavigationItems.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            className={cn('nav-btn', activePage === id && 'active')}
            onClick={() => setPage(id)}
            title={label}
            aria-label={label}
            aria-current={activePage === id ? 'page' : undefined}
          >
            <Icon size={18} />
          </button>
        ))}
      </div>
      <div className="nav-bottom">
        <button
          className={cn('nav-btn', activePage === 'settings' && 'active')}
          onClick={() => setPage('settings')}
          title="Settings"
          aria-label="Settings"
        >
          <Settings size={18} />
        </button>
      </div>
    </nav>
  )
}
