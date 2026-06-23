import React from 'react'
import { NavSidebar } from './NavSidebar'
import { useUIStore } from '@renderer/store'
import { cn } from '@renderer/utils'

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
