import React, { useEffect, useState } from 'react'
import { SessionList } from '@renderer/pages/Chat/SessionList'
import { ChatPanel } from '@renderer/pages/Chat'
import { NavSidebar } from '@renderer/components/layout/NavSidebar'
import { SettingsPage } from '@renderer/pages/Settings'
import { PersonasPage } from '@renderer/pages/Personas'
import { Onboarding } from '@renderer/pages/Onboarding'
import { ToolManagePage } from '@renderer/pages/Tools'
import { ToolDetailPage } from '@renderer/pages/Tools/ToolDetailPage'
import { SkillsMarket } from '@renderer/pages/Skills'
import { useSessionStore, usePersonaStore, useSettingsStore, useUIStore, useChatStore } from '@renderer/store'
import { applyTheme } from '@renderer/api'

export function App() {
  const { loadSessions, createSession } = useSessionStore()
  const { loadPersonas } = usePersonaStore()
  const { loadSettings, settings } = useSettingsStore()
  const { activePage, showOnboarding, setShowOnboarding, theme } = useUIStore()
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null)

  useEffect(() => {
    const init = async () => {
      await loadSettings()
      await loadPersonas()
      await loadSessions()
    }
    init()
  }, [])

  useEffect(() => {
    if (Object.keys(settings).length > 0 && settings.onboarding_done !== 'true') {
      setShowOnboarding(true)
    }
  }, [settings.onboarding_done])

  useEffect(() => {
    applyTheme((settings.theme as 'light' | 'dark' | 'system') || theme || 'system')
  }, [settings.theme, theme])

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'n') {
        e.preventDefault()
        const s = await createSession()
        await useChatStore.getState().loadMessages(s.id)
      }
      if (mod && e.key === ',') {
        e.preventDefault()
        useUIStore.getState().setPage('settings')
      }
      if (mod && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault()
        const cur = useUIStore.getState().theme
        useUIStore.getState().setTheme(cur === 'dark' ? 'light' : 'dark')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Reset tool detail view when leaving Tools page
  useEffect(() => {
    if (activePage !== 'tools') setSelectedToolId(null)
  }, [activePage])

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
        {activePage === 'tools' && (
          <div className="page-full">
            {selectedToolId ? (
              <ToolDetailPage toolId={selectedToolId} onBack={() => setSelectedToolId(null)} />
            ) : (
              <ToolManagePage onOpenDetail={setSelectedToolId} />
            )}
          </div>
        )}
        {activePage === 'skills' && (
          <div className="page-full">
            <SkillsMarket />
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
