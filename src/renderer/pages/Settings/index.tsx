import React, { useState } from 'react'
import { Eye, EyeOff, Check, Sun, Moon, Monitor } from 'lucide-react'
import { useSettingsStore, useUIStore } from '@renderer/store'
import { cn } from '@renderer/utils'
import { AVAILABLE_MODELS } from '@shared/constants'

type Tab = 'models' | 'shortcuts' | 'appearance' | 'privacy'

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('models')
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)
  const { settings, updateSetting, updateSettings } = useSettingsStore()
  const { theme, setTheme } = useUIStore()

  const [apiKey, setApiKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')

  const saveKeys = async () => {
    const updates: Record<string, string> = {}
    if (apiKey) updates['anthropic_api_key'] = apiKey
    if (openaiKey) updates['openai_api_key'] = openaiKey
    if (Object.keys(updates).length > 0) {
      await updateSettings(updates)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'models', label: 'Models' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'shortcuts', label: 'Shortcuts' },
    { id: 'privacy', label: 'Privacy' },
  ]

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1 className="settings-title">Settings</h1>
      </div>
      <div className="settings-tabs" role="tablist">
        {tabs.map(t => (
          <button
            key={t.id}
            role="tab"
            className={cn('settings-tab', tab === t.id && 'active')}
            onClick={() => setTab(t.id)}
            aria-selected={tab === t.id}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="settings-body" role="tabpanel">

        {tab === 'models' && (
          <div className="settings-section">
            <div className="settings-group">
              <div className="settings-group-title">Default Model</div>
              <div className="model-list">
                {AVAILABLE_MODELS.map(m => (
                  <button
                    key={m.id}
                    className={cn('model-card', settings.model === m.id && 'selected')}
                    onClick={() => updateSetting('model', m.id)}
                  >
                    <div className="model-card-info">
                      <div className="model-card-name">{m.label}</div>
                      <div className="model-card-sub">{m.provider}{m.badge ? ` · ${m.badge}` : ''}</div>
                    </div>
                    {settings.model === m.id && <Check size={14} className="model-card-check" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-group">
              <div className="settings-group-title">API Keys</div>
              <div className="api-key-row">
                <label className="api-key-label">Anthropic</label>
                <div className="api-key-input-wrap">
                  <input
                    type={showKey ? 'text' : 'password'}
                    className="api-key-input"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder="sk-ant-…"
                    aria-label="Anthropic API Key"
                  />
                  <button
                    className="api-key-toggle"
                    onClick={() => setShowKey(!showKey)}
                    aria-label={showKey ? 'Hide key' : 'Show key'}
                  >
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div className="api-key-row">
                <label className="api-key-label">OpenAI</label>
                <div className="api-key-input-wrap">
                  <input
                    type={showKey ? 'text' : 'password'}
                    className="api-key-input"
                    value={openaiKey}
                    onChange={e => setOpenaiKey(e.target.value)}
                    placeholder="sk-…"
                    aria-label="OpenAI API Key"
                  />
                </div>
              </div>
              <button className={cn('btn-primary', saved && 'saved')} onClick={saveKeys}>
                {saved ? <><Check size={14} /> Saved</> : 'Save Keys'}
              </button>
              <p className="api-key-hint">Keys are stored locally and never sent to BloomAI servers.</p>
            </div>
          </div>
        )}

        {tab === 'appearance' && (
          <div className="settings-section">
            <div className="settings-group">
              <div className="settings-group-title">Theme</div>
              <div className="theme-options">
                {([
                  { id: 'light', label: 'Light', icon: Sun },
                  { id: 'dark', label: 'Dark', icon: Moon },
                  { id: 'system', label: 'System', icon: Monitor },
                ] as const).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    className={cn('theme-option', theme === id && 'selected')}
                    onClick={() => setTheme(id)}
                    aria-pressed={theme === id}
                  >
                    <Icon size={18} />
                    <span>{label}</span>
                    {theme === id && <Check size={12} className="theme-check" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'shortcuts' && (
          <div className="settings-section">
            <div className="settings-group">
              <div className="settings-group-title">Keyboard Shortcuts</div>
              {[
                { label: 'New session', key: '⌘ N' },
                { label: 'Search sessions', key: '⌘ K' },
                { label: 'Toggle theme', key: '⌘ ⇧ D' },
                { label: 'Open settings', key: '⌘ ,' },
              ].map(({ label, key }) => (
                <div key={label} className="shortcut-row">
                  <span className="shortcut-label">{label}</span>
                  <kbd className="shortcut-key">{key}</kbd>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'privacy' && (
          <div className="settings-section">
            <div className="settings-group">
              <div className="settings-group-title">Data & Privacy</div>
              {[
                { key: 'clipboard_monitoring', label: 'Clipboard monitoring', desc: 'Auto-detect copied content for context' },
                { key: 'context_awareness', label: 'Active app context', desc: 'Include active window name in prompts' },
              ].map(({ key, label, desc }) => (
                <div key={key} className="settings-toggle-row">
                  <div>
                    <div className="toggle-label">{label}</div>
                    <div className="toggle-desc">{desc}</div>
                  </div>
                  <button
                    className={cn('toggle', settings[key] !== 'false' && 'on')}
                    onClick={() => updateSetting(key, settings[key] !== 'false' ? 'false' : 'true')}
                    role="switch"
                    aria-checked={settings[key] !== 'false'}
                    aria-label={label}
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
              ))}
            </div>
            <div className="settings-group">
              <div className="settings-group-title">Data Storage</div>
              <p className="settings-text">
                All conversations are stored locally on your device. No data is sent to BloomAI servers. API calls go directly to Anthropic/OpenAI.
              </p>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
