import React from 'react'
import { MessageCircle, Settings, User } from 'lucide-react'
import { useUIStore } from '../../stores/index'
import { cn } from '../../lib/utils'

export function NavSidebar() {
  const { activePage, setPage } = useUIStore()

  const items = [
    { id: 'chat' as const, icon: MessageCircle, label: 'Chat' },
    { id: 'personas' as const, icon: User, label: 'Personas' },
  ]

  return (
    <nav className="nav-sidebar" aria-label="Main navigation">
      <div className="nav-logo">
        <span className="nav-logo-text">B</span>
      </div>
      <div className="nav-items">
        {items.map(({ id, icon: Icon, label }) => (
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
