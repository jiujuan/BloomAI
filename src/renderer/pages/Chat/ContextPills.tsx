import React, { useEffect, useState } from 'react'
import { X, Plus, Monitor } from 'lucide-react'
import { platform } from '@renderer/api'
import { useSettingsStore } from '@renderer/store'
import { cn } from '@renderer/utils'

type ChatContextPayload = { activeApp?: string }

interface ContextPillsProps {
  onContextChange: (ctx: ChatContextPayload) => void
}

export function getChatContextPayload(input: { activeApp: string; appEnabled: boolean; clipboard?: string }): ChatContextPayload {
  return {
    activeApp: input.appEnabled ? input.activeApp || undefined : undefined,
  }
}

export function ContextPills({ onContextChange }: ContextPillsProps) {
  const { settings } = useSettingsStore()
  const [activeApp, setActiveApp] = useState('')
  const [appEnabled, setAppEnabled] = useState(true)

  useEffect(() => {
    if (settings.context_awareness !== 'false') {
      platform.getActiveWindow().then(app => {
        if (app) setActiveApp(app)
      })
    }
  }, [settings])

  useEffect(() => {
    onContextChange(getChatContextPayload({ activeApp, appEnabled }))
  }, [activeApp, appEnabled, onContextChange])

  return (
    <div className="context-bar" role="region" aria-label="Context">
      <span className="context-label">Context</span>
      {activeApp && (
        <button
          className={cn('context-pill', appEnabled && 'active')}
          onClick={() => setAppEnabled(!appEnabled)}
          title={appEnabled ? 'Remove app context' : 'Add app context'}
        >
          <Monitor size={11} />
          <span>{activeApp}</span>
          {appEnabled && (
            <span onClick={e => { e.stopPropagation(); setAppEnabled(false) }} className="pill-x" aria-label="Remove">
              <X size={9} />
            </span>
          )}
        </button>
      )}
      <button className="context-pill neutral" title="Add context">
        <Plus size={11} />
        <span>Add</span>
      </button>
    </div>
  )
}
