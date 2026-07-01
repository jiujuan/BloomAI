import React, { useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, Check, Sun, Moon, Monitor, Search } from 'lucide-react'
import type { LlmModelSummary } from '@renderer/api'
import { platform } from '@renderer/api'
import { useLlmStore, useSettingsStore, useUIStore } from '@renderer/store'
import { cn } from '@renderer/utils'
import { AVAILABLE_MODELS } from '@shared/constants'

type Tab = 'models' | 'shortcuts' | 'appearance' | 'privacy'

const FONT_FAMILY_OPTIONS = [
  { value: 'system', label: '系统默认' },
  { value: 'segoe', label: 'Segoe UI' },
  { value: 'arial', label: 'Arial' },
  { value: 'georgia', label: 'Georgia（衬线）' },
]

const FONT_SIZE_OPTIONS = [
  { value: '12px', label: '小', desc: '12' },
  { value: '13px', label: '默认', desc: '13' },
  { value: '14px', label: '中', desc: '14' },
  { value: '15px', label: '大', desc: '15' },
  { value: '16px', label: '特大', desc: '16' },
]

interface ProviderInfo {
  label: string
  apiKeyKey?: string
  apiKeyPlaceholder?: string
  baseUrlKey?: string
  baseUrlDefault: string
  baseUrlLabel?: string
}

const PROVIDER_INFO: Record<string, ProviderInfo> = {
  anthropic: { label: 'Anthropic', apiKeyKey: 'anthropic_api_key', apiKeyPlaceholder: 'sk-ant-...', baseUrlDefault: 'https://api.anthropic.com' },
  openai:    { label: 'OpenAI',    apiKeyKey: 'openai_api_key',    apiKeyPlaceholder: 'sk-...',     baseUrlDefault: 'https://api.openai.com/v1' },
  agnes:     { label: 'Agnes',     apiKeyKey: 'agnes_api_key',     apiKeyPlaceholder: 'Agnes API key', baseUrlDefault: 'https://apihub.agnes-ai.com/v1' },
  deepseek:  { label: 'DeepSeek', apiKeyKey: 'deepseek_api_key',  apiKeyPlaceholder: 'DeepSeek API key', baseUrlDefault: 'https://api.deepseek.com/v1' },
  ollama:    { label: 'Ollama',    baseUrlKey: 'ollama_base_url',  baseUrlDefault: 'http://127.0.0.1:11434', baseUrlLabel: 'Base URL' },
  google:    { label: 'Google AI', apiKeyKey: 'google_api_key',   apiKeyPlaceholder: 'AIzaSy...', baseUrlDefault: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  together:  { label: 'Together.ai', apiKeyKey: 'together_api_key', apiKeyPlaceholder: 'Together.ai API key', baseUrlDefault: 'https://api.together.xyz/v1' },
  qwen:      { label: 'Qwen (DashScope)', apiKeyKey: 'qwen_api_key', apiKeyPlaceholder: 'DashScope API key', baseUrlDefault: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
}

const MODALITY_LABEL: Record<string, string> = { text: 'Text', image: 'Image', video: 'Video' }

const DEFAULT_SETTING_KEY: Record<string, string> = {
  text: 'model',
  image: 'default_image_model',
  video: 'default_video_model',
}

function groupBy<T>(arr: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of arr) {
    const k = key(item)
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(item)
  }
  return map
}

// ------ Two-column Models panel ------

function ModelDetailPanel({
  model,
  settings,
  updateSettings,
  updateSetting,
  onRefresh,
}: {
  model: LlmModelSummary
  settings: Record<string, string>
  updateSettings: (updates: Record<string, string>) => Promise<void>
  updateSetting: (key: string, value: string) => Promise<void>
  onRefresh: () => void
}) {
  const [localValues, setLocalValues] = useState<Record<string, string>>({})
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)
  const info = PROVIDER_INFO[model.providerId]
  const defaultSettingKey = DEFAULT_SETTING_KEY[model.modality]

  // Reset local state when model changes
  useEffect(() => {
    setLocalValues({})
    setSaved(false)
    setShowKey(false)
  }, [model.id])

  const isDefault = defaultSettingKey ? settings[defaultSettingKey] === model.id : false

  const apiKeyValue = info?.apiKeyKey ? (localValues[info.apiKeyKey] ?? '') : ''
  const apiKeySaved = info?.apiKeyKey ? settings[info.apiKeyKey] === '***masked***' : false

  const baseUrlValue = info?.baseUrlKey ? (localValues[info.baseUrlKey] ?? '') : ''
  const baseUrlSaved = info?.baseUrlKey ? !!settings[info.baseUrlKey] : false

  const save = async () => {
    const updates: Record<string, string> = {}
    if (info?.apiKeyKey && localValues[info.apiKeyKey]?.trim()) {
      updates[info.apiKeyKey] = localValues[info.apiKeyKey].trim()
    }
    if (info?.baseUrlKey && localValues[info.baseUrlKey]?.trim()) {
      updates[info.baseUrlKey] = localValues[info.baseUrlKey].trim()
    }
    if (Object.keys(updates).length) await updateSettings(updates)
    setLocalValues({})
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const toggleEnabled = async () => {
    await platform.updateLlmModel(model.id, { is_enabled: model.isEnabled ? 0 : 1 })
    onRefresh()
  }

  const setDefault = async () => {
    if (defaultSettingKey) await updateSetting(defaultSettingKey, model.id)
  }

  const canSave = (info?.apiKeyKey ? !!localValues[info.apiKeyKey]?.trim() : false)
               || (info?.baseUrlKey ? !!localValues[info.baseUrlKey]?.trim() : false)

  return (
    <div className="settings-model-detail">
      <div className="smd-header">
        <div className="smd-title">{model.label}</div>
        <div className="smd-meta">
          <span>{info?.label || model.providerId}</span>
          <span className={cn('smd-badge', `smd-badge-${model.modality}`)}>
            {MODALITY_LABEL[model.modality] || model.modality}
          </span>
          {!model.isEnabled && <span className="smd-badge smd-badge-disabled">已禁用</span>}
        </div>
        <div className="smd-model-id">{model.modelId}</div>
      </div>

      <div className="smd-body">
        {info?.apiKeyKey && (
          <div className="smd-field">
            <label className="smd-label">API Key</label>
            <div className="api-key-input-wrap">
              <input
                type={showKey ? 'text' : 'password'}
                className="api-key-input"
                value={apiKeyValue}
                onChange={e => setLocalValues(v => ({ ...v, [info.apiKeyKey!]: e.target.value }))}
                placeholder={apiKeySaved ? 'Saved' : (info.apiKeyPlaceholder || 'API key')}
              />
              <button className="api-key-toggle" onClick={() => setShowKey(!showKey)} aria-label={showKey ? 'Hide' : 'Show'}>
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        )}

        {info?.baseUrlKey && (
          <div className="smd-field">
            <label className="smd-label">{info.baseUrlLabel || 'Base URL'}</label>
            <input
              type="text"
              className="api-key-input"
              value={baseUrlValue}
              onChange={e => setLocalValues(v => ({ ...v, [info.baseUrlKey!]: e.target.value }))}
              placeholder={baseUrlSaved ? settings[info.baseUrlKey!] || info.baseUrlDefault : info.baseUrlDefault}
            />
          </div>
        )}

        {!info?.apiKeyKey && !info?.baseUrlKey && (
          <p className="smd-note">
            Provider base URL: <code>{info?.baseUrlDefault}</code>
          </p>
        )}

        <div className="smd-actions">
          <div className="smd-toggles">
            <button
              className={cn('toggle', model.isEnabled && 'on')}
              onClick={toggleEnabled}
              role="switch"
              aria-checked={model.isEnabled}
              aria-label={model.isEnabled ? '禁用此模型' : '启用此模型'}
            >
              <span className="toggle-knob" />
            </button>
            <span className="smd-toggle-label">{model.isEnabled ? '已启用' : '已禁用'}</span>
          </div>

          {defaultSettingKey && model.isEnabled && (
            <button
              className={cn('btn-secondary btn-sm', isDefault && 'active')}
              onClick={setDefault}
              disabled={isDefault}
            >
              {isDefault ? <><Check size={13} /> 默认{MODALITY_LABEL[model.modality]}模型</> : `设为默认${MODALITY_LABEL[model.modality]}模型`}
            </button>
          )}
        </div>

        {canSave && (
          <button className={cn('btn-primary', saved && 'saved')} onClick={save}>
            {saved ? <><Check size={14} /> 已保存</> : '保存'}
          </button>
        )}
      </div>
    </div>
  )
}

// ------ Left model list ------

function ModelList({
  allModels,
  selectedId,
  onSelect,
}: {
  allModels: LlmModelSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return allModels
    const q = search.toLowerCase()
    return allModels.filter(m => m.label.toLowerCase().includes(q) || m.modelId.toLowerCase().includes(q))
  }, [allModels, search])

  const grouped = useMemo(() => groupBy(filtered, m => m.providerId), [filtered])
  const providerOrder = useMemo(() => {
    const order = ['anthropic', 'openai', 'agnes', 'deepseek', 'google', 'together', 'qwen', 'ollama']
    const extra = [...grouped.keys()].filter(k => !order.includes(k))
    return [...order.filter(k => grouped.has(k)), ...extra]
  }, [grouped])

  return (
    <div className="settings-model-list">
      <div className="sml-search">
        <Search size={14} className="sml-search-icon" />
        <input
          className="sml-search-input"
          placeholder="搜索模型..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      <div className="sml-scroll">
        {providerOrder.map(providerId => {
          const models = grouped.get(providerId)!
          const info = PROVIDER_INFO[providerId]
          return (
            <div key={providerId} className="sml-group">
              <div className="sml-group-header">{info?.label || providerId}</div>
              {models.map(m => (
                <button
                  key={m.id}
                  className={cn('sml-item', selectedId === m.id && 'selected', !m.isEnabled && 'disabled')}
                  onClick={() => onSelect(m.id)}
                >
                  <span className="sml-item-label">{m.label}</span>
                  <span className={cn('sml-badge', `sml-badge-${m.modality}`)}>
                    {MODALITY_LABEL[m.modality] || m.modality}
                  </span>
                </button>
              ))}
            </div>
          )
        })}
        {filtered.length === 0 && <p className="sml-empty">没有匹配的模型</p>}
      </div>
    </div>
  )
}

// ------ Main Settings page ------

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('models')
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const { settings, updateSetting, updateSettings } = useSettingsStore()
  const {
    textModels: backendTextModels,
    imageModels,
    videoModels,
    loading: modelsLoading,
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
      modality: 'text' as const,
      capabilities: model.badge ? { badge: model.badge } : {},
      isEnabled: true,
      isBuiltin: true,
      sortOrder: index,
    }))
  }, [backendTextModels])

  const allModels = useMemo(
    () => [...textModels, ...imageModels, ...videoModels],
    [textModels, imageModels, videoModels]
  )

  const selectedModel = selectedModelId ? allModels.find(m => m.id === selectedModelId) || null : null

  // Auto-select first model once loaded
  useEffect(() => {
    if (!selectedModelId && allModels.length > 0) setSelectedModelId(allModels[0].id)
  }, [allModels, selectedModelId])

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

      <div className={cn('settings-body', tab === 'models' && 'settings-body-models')} role="tabpanel">
        {tab === 'models' && (
          <div className="settings-models-panel">
            {modelsLoading ? (
              <p className="api-key-hint" style={{ padding: '16px' }}>Loading models...</p>
            ) : (
              <>
                <ModelList
                  allModels={allModels}
                  selectedId={selectedModelId}
                  onSelect={setSelectedModelId}
                />
                <div className="settings-model-detail-wrap">
                  {selectedModel ? (
                    <ModelDetailPanel
                      key={selectedModel.id}
                      model={selectedModel}
                      settings={settings}
                      updateSettings={updateSettings}
                      updateSetting={updateSetting}
                      onRefresh={loadModels}
                    />
                  ) : (
                    <div className="smd-placeholder">选择左侧模型查看详情</div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'appearance' && (
          <div className="settings-section">
            <div className="settings-group">
              <div className="settings-group-title">主题</div>
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

            <div className="settings-group">
              <div className="settings-group-title">界面字体</div>
              <select
                className="appearance-select"
                value={settings.font_family || 'system'}
                onChange={(e) => updateSetting('font_family', e.target.value)}
              >
                {FONT_FAMILY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="settings-group">
              <div className="settings-group-title">界面字号</div>
              <div className="font-size-options">
                {FONT_SIZE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={cn('font-size-option', (settings.font_size || '13px') === opt.value && 'selected')}
                    onClick={() => updateSetting('font_size', opt.value)}
                    aria-pressed={(settings.font_size || '13px') === opt.value}
                  >
                    <span style={{ fontSize: opt.value, lineHeight: 1, fontWeight: 500 }}>A</span>
                    <span className="font-size-label">{opt.label}</span>
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
