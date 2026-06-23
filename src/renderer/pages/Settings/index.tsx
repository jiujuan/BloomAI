import React, { useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, Check, Sun, Moon, Monitor } from 'lucide-react'
import type { LlmModelSummary } from '@renderer/api'
import { useLlmStore, useSettingsStore, useUIStore } from '@renderer/store'
import { cn } from '@renderer/utils'
import { AVAILABLE_MODELS } from '@shared/constants'

type Tab = 'models' | 'shortcuts' | 'appearance' | 'privacy'
type ModelSettingKey = 'model' | 'default_image_model' | 'default_video_model'

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  agnes: 'Agnes',
  deepseek: 'DeepSeek',
  ollama: 'Ollama',
}

const KEY_ROWS = [
  { key: 'anthropic_api_key', label: 'Anthropic', placeholder: 'sk-ant-...' },
  { key: 'openai_api_key', label: 'OpenAI', placeholder: 'sk-...' },
  { key: 'agnes_api_key', label: 'Agnes', placeholder: 'Agnes API key' },
  { key: 'deepseek_api_key', label: 'DeepSeek', placeholder: 'DeepSeek API key' },
  { key: 'ollama_base_url', label: 'Ollama URL', placeholder: 'http://127.0.0.1:11434', plainText: true },
]

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('models')
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)
  const [apiValues, setApiValues] = useState<Record<string, string>>({})
  const { settings, updateSetting, updateSettings } = useSettingsStore()
  const {
    textModels: backendTextModels,
    imageModels,
    videoModels,
    loading: modelsLoading,
    error: modelsError,
    loadModels,
  } = useLlmStore()
  const { theme, setTheme } = useUIStore()

  useEffect(() => {
    loadModels()
  }, [loadModels])

  const textModels = useMemo<LlmModelSummary[]>(() => {
    if (backendTextModels.length) return backendTextModels
    return AVAILABLE_MODELS.map((model, index) => ({
      id: model.id,
      providerId: model.provider.toLowerCase(),
      modelId: model.id,
      label: model.label,
      modality: 'text',
      capabilities: model.badge ? { badge: model.badge } : {},
      isEnabled: true,
      isBuiltin: true,
      sortOrder: index,
    }))
  }, [backendTextModels])

  const saveProviderSettings = async () => {
    const updates: Record<string, string> = {}
    for (const row of KEY_ROWS) {
      const value = apiValues[row.key]?.trim()
      if (value) updates[row.key] = value
    }
    if (!Object.keys(updates).length) return

    await updateSettings(updates)
    setApiValues({})
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const renderModelList = (models: LlmModelSummary[], selected: string | undefined, settingKey: ModelSettingKey) => (
    <div className="model-list">
      {models.map(model => (
        <button
          key={model.id}
          className={cn('model-card', selected === model.id && 'selected')}
          onClick={() => updateSetting(settingKey, model.id)}
        >
          <div className="model-card-info">
            <div className="model-card-name">{model.label}</div>
            <div className="model-card-sub">
              {PROVIDER_NAMES[model.providerId] || model.providerId}
              {model.capabilities.badge ? ` · ${String(model.capabilities.badge)}` : ''}
            </div>
          </div>
          {selected === model.id && <Check size={14} className="model-card-check" />}
        </button>
      ))}
      {!models.length && <p className="api-key-hint">No enabled models are available.</p>}
    </div>
  )

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
              <div className="settings-group-title">Default Chat Model</div>
              {modelsLoading && <p className="api-key-hint">Loading models...</p>}
              {modelsError && <p className="api-key-hint">Using fallback chat models. {modelsError}</p>}
              {renderModelList(textModels, settings.model, 'model')}
            </div>

            <div className="settings-group">
              <div className="settings-group-title">API Keys</div>
              {KEY_ROWS.map(row => (
                <div className="api-key-row" key={row.key}>
                  <label className="api-key-label" htmlFor={row.key}>{row.label}</label>
                  <div className="api-key-input-wrap">
                    <input
                      id={row.key}
                      type={row.plainText || showKey ? 'text' : 'password'}
                      className="api-key-input"
                      value={apiValues[row.key] || ''}
                      onChange={event => setApiValues(current => ({ ...current, [row.key]: event.target.value }))}
                      placeholder={settings[row.key] === '***masked***' ? 'Saved' : row.placeholder}
                      aria-label={row.label}
                    />
                    {!row.plainText && row.key === 'anthropic_api_key' && (
                      <button
                        className="api-key-toggle"
                        onClick={() => setShowKey(!showKey)}
                        aria-label={showKey ? 'Hide keys' : 'Show keys'}
                      >
                        {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <button className={cn('btn-primary', saved && 'saved')} onClick={saveProviderSettings}>
                {saved ? <><Check size={14} /> Saved</> : 'Save Provider Settings'}
              </button>
              <p className="api-key-hint">Provider keys and local endpoints are stored on this device.</p>
            </div>

            <div className="settings-group">
              <div className="settings-group-title">Default Image Model</div>
              {renderModelList(imageModels, settings.default_image_model, 'default_image_model')}
            </div>

            <div className="settings-group">
              <div className="settings-group-title">Default Video Model</div>
              {renderModelList(videoModels, settings.default_video_model, 'default_video_model')}
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
                { label: 'New session', key: 'Cmd N' },
                { label: 'Search sessions', key: 'Cmd K' },
                { label: 'Toggle theme', key: 'Cmd Shift D' },
                { label: 'Open settings', key: 'Cmd ,' },
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
                All conversations are stored locally on your device. No data is sent to BloomAI servers. API calls go directly to configured providers.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
