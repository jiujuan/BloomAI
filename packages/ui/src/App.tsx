import React, { useEffect } from 'react'
import { SessionList } from './components/chat/SessionList'
import { ChatPanel } from './components/chat/ChatPanel'
import { NavSidebar } from './components/layout/NavSidebar'
import { SettingsPage } from './components/settings/SettingsPage'
import { PersonasPage } from './components/persona/PersonasPage'
import { Onboarding } from './components/shared/Onboarding'
import { useSessionStore, usePersonaStore, useSettingsStore, useUIStore } from './stores/index'
import { applyTheme } from './lib/platform'

export function App() {
  const { loadSessions, createSession, activeSessionId } = useSessionStore()
  const { loadPersonas } = usePersonaStore()
  const { loadSettings, settings } = useSettingsStore()
  const { activePage, showOnboarding, setShowOnboarding, theme } = useUIStore()

  useEffect(() => {
    const init = async () => {
      await loadSettings()
      await loadPersonas()
      await loadSessions()
    }
    init()
  }, [])

  useEffect(() => {
    if (settings.onboarding_done !== 'true' && Object.keys(settings).length > 0) {
      setShowOnboarding(true)
    }
  }, [settings.onboarding_done])

  useEffect(() => {
    applyTheme((settings.theme as any) || theme || 'system')
  }, [settings.theme, theme])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        const s = await createSession()
        const { loadMessages } = await import('./stores/index').then(m => m.useChatStore.getState())
        await loadMessages(s.id)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        useUIStore.getState().setPage('settings')
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'D') {
        e.preventDefault()
        const current = useUIStore.getState().theme
        useUIStore.getState().setTheme(current === 'dark' ? 'light' : 'dark')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="app-root">
      {showOnboarding && <Onboarding />}
      <div className="app-shell">
        <NavSidebar />
        {activePage === 'chat' && (
          <>
            <SessionList />
            <ChatPanel />
          </>
        )}
        {activePage === 'personas' && (
          <div className="page-full">
            <PersonasPage />
          </div>
        )}
        {activePage === 'settings' && (
          <div className="page-full">
            <SettingsPage />
          </div>
        )}
      </div>
    </div>
  )
}
