import React from 'react'
import { NavSidebar } from './NavSidebar'
import { useUIStore } from '../../stores/index'
import { cn } from '../../lib/utils'

interface AppShellProps {
  children: React.ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const { sidebarOpen } = useUIStore()
  return (
    <div className="app-shell">
      <NavSidebar />
      <main className={cn('app-main', sidebarOpen && 'with-sidebar')}>
        {children}
      </main>
    </div>
  )
}
