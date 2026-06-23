import React, { useEffect, useState } from 'react'
import { X, Plus, Monitor, Clipboard } from 'lucide-react'
import { platform } from '@renderer/api'
import { useSettingsStore } from '@renderer/store'
import { cn } from '@renderer/utils'

interface ContextPillsProps {
  onContextChange: (ctx: { activeApp?: string; clipboardContent?: string }) => void
}

export function ContextPills({ onContextChange }: ContextPillsProps) {
  const { settings } = useSettingsStore()
  const [activeApp, setActiveApp] = useState('')
  const [clipboard, setClipboard] = useState('')
  const [appEnabled, setAppEnabled] = useState(true)
  const [clipEnabled, setClipEnabled] = useState(true)

  useEffect(() => {
    if (settings.context_awareness !== 'false') {
      platform.getActiveWindow().then(app => {
        if (app) setActiveApp(app)
      })
    }
    if (settings.clipboard_monitoring !== 'false') {
      platform.readClipboard().then(text => {
        if (text && text.length > 0 && text.length < 5000) setClipboard(text)
      })
    }
  }, [settings])

  useEffect(() => {
    onContextChange({
      activeApp: appEnabled ? activeApp : undefined,
      clipboardContent: clipEnabled ? clipboard : undefined,
    })
  }, [activeApp, clipboard, appEnabled, clipEnabled])

  const clipPreview = clipboard.slice(0, 40) + (clipboard.length > 40 ? '…' : '')

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
      {clipboard && (
        <button
          className={cn('context-pill', clipEnabled && 'active', 'warn')}
          onClick={() => setClipEnabled(!clipEnabled)}
          title={clipEnabled ? 'Remove clipboard context' : 'Add clipboard context'}
        >
          <Clipboard size={11} />
          <span>{clipPreview}</span>
          {clipEnabled && (
            <span onClick={e => { e.stopPropagation(); setClipEnabled(false) }} className="pill-x" aria-label="Remove">
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
