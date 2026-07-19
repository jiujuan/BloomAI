import React, { useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, Check, Sun, Moon, Monitor, Search, Star, CircleDot, Circle, Plus } from 'lucide-react'
import type { LlmModelSummary, LlmProviderSummary } from '@renderer/api'
import { platform } from '@renderer/api'
import { useLlmStore, useSettingsStore, useUIStore } from '@renderer/store'
import { cn } from '@renderer/utils'
import { AVAILABLE_MODELS } from '@shared/constants'

type Tab = 'models' | 'shortcuts' | 'appearance' | 'privacy'
type RightPanelMode = 'detail' | 'add-provider' | 'add-model'

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
  baseUrlDefault: string
}

const PROVIDER_INFO: Record<string, ProviderInfo> = {
  anthropic: { label: 'Anthropic',       apiKeyKey: 'anthropic_api_key', apiKeyPlaceholder: 'sk-ant-...', baseUrlDefault: 'https://api.anthropic.com' },
  openai:    { label: 'OpenAI',          apiKeyKey: 'openai_api_key',    apiKeyPlaceholder: 'sk-...',     baseUrlDefault: 'https://api.openai.com/v1' },
  agnes:     { label: 'Agnes',           apiKeyKey: 'agnes_api_key',     apiKeyPlaceholder: 'Agnes API key', baseUrlDefault: 'https://apihub.agnes-ai.com/v1' },
  deepseek:  { label: 'DeepSeek',        apiKeyKey: 'deepseek_api_key',  apiKeyPlaceholder: 'DeepSeek API key', baseUrlDefault: 'https://api.deepseek.com/v1' },
  ollama:    { label: 'Ollama',          baseUrlDefault: 'http://127.0.0.1:11434' },
  google:    { label: 'Google AI',       apiKeyKey: 'google_api_key',    apiKeyPlaceholder: 'AIzaSy...', baseUrlDefault: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  together:  { label: 'Together.ai',     apiKeyKey: 'together_api_key',  apiKeyPlaceholder: 'Together.ai API key', baseUrlDefault: 'https://api.together.xyz/v1' },
  qwen:      { label: 'Qwen (DashScope)', apiKeyKey: 'qwen_api_key',     apiKeyPlaceholder: 'DashScope API key', baseUrlDefault: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
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

// ------ Right detail panel ------

function ModelDetailPanel({
  model,
  provider,
  settings,
  updateSettings,
  updateSetting,
  onRefresh,
}: {
  model: LlmModelSummary
  provider: LlmProviderSummary | undefined
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
  const isOllama = model.providerId === 'ollama'

  // For custom providers not in PROVIDER_INFO, fall back to provider.apiKeySettingKey
  const apiKeyKey = info?.apiKeyKey || provider?.apiKeySettingKey || null
  const providerLabel = info?.label || provider?.name || model.providerId

  useEffect(() => {
    setLocalValues({})
    setSaved(false)
    setShowKey(false)
  }, [model.id])

  const isDefault = defaultSettingKey ? settings[defaultSettingKey] === model.id : false
  const isDeepResearchModel = model.modality === 'text' && settings.deep_research_model === model.id

  const apiKeyValue = apiKeyKey ? (localValues[apiKeyKey] ?? '') : ''
  const apiKeySaved = apiKeyKey ? settings[apiKeyKey] === '***masked***' : false
  const isDeepResearchFallback = model.modality === 'text' && !settings.deep_research_model && settings.model === model.id
  const hasConfiguredCredential = isOllama || provider?.hasApiKey === true || apiKeySaved || !apiKeyKey
  const researchRuntimeReady = model.modality === 'text' && model.isEnabled && provider?.isEnabled !== false && hasConfiguredCredential

  const baseUrlDefault = info?.baseUrlDefault || ''
  const currentBaseUrl = isOllama
    ? (settings['ollama_base_url'] || baseUrlDefault)
    : (provider?.baseUrl || baseUrlDefault)
  const baseUrlValue = localValues['__base_url__'] ?? ''

  const save = async () => {
    const settingsUpdates: Record<string, string> = {}
    if (apiKeyKey && localValues[apiKeyKey]?.trim()) {
      settingsUpdates[apiKeyKey] = localValues[apiKeyKey].trim()
    }
    if (Object.keys(settingsUpdates).length) await updateSettings(settingsUpdates)

    if (localValues['__base_url__'] !== undefined) {
      const newBaseUrl = localValues['__base_url__'].trim()
      if (isOllama) {
        await updateSettings({ ollama_base_url: newBaseUrl })
      } else {
        await platform.updateLlmProvider(model.providerId, { baseUrl: newBaseUrl || null })
      }
    }

    setLocalValues({})
    setSaved(true)
    onRefresh()
    setTimeout(() => setSaved(false), 2000)
  }

  const cancel = () => setLocalValues({})

  const toggleEnabled = async () => {
    await platform.updateLlmModel(model.id, { isEnabled: !model.isEnabled })
    onRefresh()
  }

  const setDefault = async () => {
    if (defaultSettingKey) await updateSetting(defaultSettingKey, model.id)
  }

  const setDeepResearchModel = async () => {
    await updateSetting('deep_research_model', model.id)
  }

  const hasApiKeyChange = apiKeyKey ? !!localValues[apiKeyKey]?.trim() : false
  const hasBaseUrlChange = localValues['__base_url__'] !== undefined
  const canSave = hasApiKeyChange || hasBaseUrlChange

  return (
    <div className="settings-model-detail">
      <div className="smd-header">
        <div className="smd-title">{model.label}</div>
        <div className="smd-meta">
          <span>{providerLabel}</span>
          <span className={cn('smd-badge', `smd-badge-${model.modality}`)}>
            {MODALITY_LABEL[model.modality] || model.modality}
          </span>
          {!model.isEnabled && <span className="smd-badge smd-badge-disabled">已禁用</span>}
          {isDefault && <span className="smd-badge smd-badge-default">默认</span>}
        </div>
        <div className="smd-model-id">{model.modelId}</div>
      </div>

      <div className="smd-body">
        {(isDeepResearchModel || isDeepResearchFallback) && <div className="smd-field" aria-label="深度研究运行状态">
          <label className="smd-label">深度研究运行状态</label>
          <p className="api-key-hint">
            {isDeepResearchModel ? '此模型由 deep_research_model 专用设置选择。' : '未设置专用模型；深度研究将回退到通用文本模型。'}
            {' '}{researchRuntimeReady ? '就绪：模型、厂商和凭据配置满足运行前检查。' : '未就绪：请启用模型和厂商，并配置所需凭据后再运行。'}
          </p>
          <p className="api-key-hint">凭据仅显示为已配置状态，不会在此处展示 Key 内容。</p>
        </div>}
        {apiKeyKey && (
          <div className="smd-field">
            <label className="smd-label">API Key</label>
            <div className="api-key-input-wrap">
              <input
                type={showKey ? 'text' : 'password'}
                className="api-key-input"
                value={apiKeyValue}
                onChange={e => setLocalValues(v => ({ ...v, [apiKeyKey]: e.target.value }))}
                placeholder={apiKeySaved ? 'Saved' : (info?.apiKeyPlaceholder || 'API key')}
              />
              <button className="api-key-toggle" onClick={() => setShowKey(!showKey)} aria-label={showKey ? 'Hide' : 'Show'}>
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        )}

        <div className="smd-field">
          <label className="smd-label">Base URL</label>
          <div className="api-key-input-wrap">
            <input
              type="text"
              className="api-key-input"
              value={baseUrlValue}
              onChange={e => setLocalValues(v => ({ ...v, '__base_url__': e.target.value }))}
              placeholder={currentBaseUrl || baseUrlDefault}
            />
          </div>
        </div>

        <div className="smd-save-row">
          <button className={cn('btn-primary btn-sm', saved && 'saved')} onClick={save}>
            {saved ? <><Check size={13} /> 已保存</> : '保存'}
          </button>
          {canSave && (
            <button className="btn-secondary btn-sm" onClick={cancel}>
              取消
            </button>
          )}
        </div>

        <div className="smd-divider" />

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
              {isDefault
                ? <><Star size={12} fill="currentColor" /> 已是默认</>
                : `设为默认${MODALITY_LABEL[model.modality]}`}
            </button>
          )}
          {model.modality === 'text' && model.isEnabled && (
            <button
              className={cn('btn-secondary btn-sm', isDeepResearchModel && 'active')}
              onClick={setDeepResearchModel}
              disabled={isDeepResearchModel}
            >
              {isDeepResearchModel
                ? <><Star size={12} fill="currentColor" /> 已是深度研究模型</>
                : '设为深度研究模型'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ------ Add Provider panel ------

function AddProviderPanel({
  onCancel,
  onCreated,
}: {
  onCancel: () => void
  onCreated: (provider: LlmProviderSummary) => void
}) {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'openai-compatible' | 'openai' | 'anthropic' | 'ollama'>('openai-compatible')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKeySettingKey, setApiKeySettingKey] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const handleIdChange = (val: string) => {
    const cleaned = val.toLowerCase().replace(/[^a-z0-9-]/g, '')
    setId(cleaned)
    setApiKeySettingKey(cleaned ? `${cleaned}_api_key` : '')
  }

  const submit = async () => {
    if (!id.trim() || !name.trim()) {
      setError('厂商 ID 和名称为必填项')
      return
    }
    setSaving(true)
    setError('')
    try {
      const provider = await platform.createLlmProvider({
        id: id.trim(),
        name: name.trim(),
        kind,
        baseUrl: baseUrl.trim() || undefined,
        apiKeySettingKey: apiKeySettingKey.trim() || undefined,
      })
      onCreated(provider)
    } catch (err: any) {
      setError(err.message || '创建失败')
      setSaving(false)
    }
  }

  return (
    <div className="settings-model-detail">
      <div className="smd-header">
        <div className="smd-title">添加厂商</div>
        <div className="smd-meta">新增 AI 模型厂商及其配置</div>
      </div>
      <div className="smd-body">
        <div className="smd-field">
          <label className="smd-label">厂商 ID（唯一标识，小写英文/数字/-）</label>
          <div className="api-key-input-wrap">
            <input
              className="api-key-input"
              value={id}
              onChange={e => handleIdChange(e.target.value)}
              placeholder="例如：zhipu"
            />
          </div>
        </div>
        <div className="smd-field">
          <label className="smd-label">显示名称</label>
          <div className="api-key-input-wrap">
            <input
              className="api-key-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例如：智谱 ZhipuAI"
            />
          </div>
        </div>
        <div className="smd-field">
          <label className="smd-label">类型</label>
          <select
            className="appearance-select"
            value={kind}
            onChange={e => setKind(e.target.value as typeof kind)}
          >
            <option value="openai-compatible">OpenAI-Compatible（兼容 OpenAI 接口）</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="ollama">Ollama</option>
          </select>
        </div>
        <div className="smd-field">
          <label className="smd-label">Base URL（可选）</label>
          <div className="api-key-input-wrap">
            <input
              className="api-key-input"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="例如：https://open.bigmodel.cn/api/paas/v4"
            />
          </div>
        </div>
        <div className="smd-field">
          <label className="smd-label">API Key 设置键</label>
          <div className="api-key-input-wrap">
            <input
              className="api-key-input"
              value={apiKeySettingKey}
              onChange={e => setApiKeySettingKey(e.target.value)}
              placeholder="例如：zhipu_api_key"
            />
          </div>
          <span className="smd-note">用于存储该厂商的 API Key，自动根据 ID 生成</span>
        </div>
        {error && <p className="smd-note" style={{ color: 'var(--text-danger, #dc2626)' }}>{error}</p>}
        <div className="smd-save-row">
          <button className="btn-primary btn-sm" onClick={submit} disabled={saving}>
            {saving ? '创建中...' : '创建厂商'}
          </button>
          <button className="btn-secondary btn-sm" onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  )
}

// ------ Add Model panel ------

function AddModelPanel({
  providers,
  initialProviderId,
  onCancel,
  onCreated,
}: {
  providers: LlmProviderSummary[]
  initialProviderId?: string
  onCancel: () => void
  onCreated: (model: LlmModelSummary) => void
}) {
  const [providerId, setProviderId] = useState(initialProviderId || providers[0]?.id || '')
  const [modelId, setModelId] = useState('')
  const [label, setLabel] = useState('')
  const [modality, setModality] = useState<'text' | 'image' | 'video'>('text')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (initialProviderId) setProviderId(initialProviderId)
  }, [initialProviderId])

  const submit = async () => {
    if (!providerId || !modelId.trim() || !label.trim()) {
      setError('厂商、模型 ID 和名称为必填项')
      return
    }
    setSaving(true)
    setError('')
    try {
      const model = await platform.createLlmModel({
        providerId,
        modelId: modelId.trim(),
        label: label.trim(),
        modality,
        isBuiltin: false,
      })
      onCreated(model)
    } catch (err: any) {
      setError(err.message || '创建失败')
      setSaving(false)
    }
  }

  return (
    <div className="settings-model-detail">
      <div className="smd-header">
        <div className="smd-title">添加模型</div>
        <div className="smd-meta">为已有厂商添加新的模型</div>
      </div>
      <div className="smd-body">
        <div className="smd-field">
          <label className="smd-label">厂商</label>
          <select
            className="appearance-select"
            value={providerId}
            onChange={e => setProviderId(e.target.value)}
          >
            {providers.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="smd-field">
          <label className="smd-label">模型 ID（API 调用时使用）</label>
          <div className="api-key-input-wrap">
            <input
              className="api-key-input"
              value={modelId}
              onChange={e => setModelId(e.target.value)}
              placeholder="例如：glm-4v-flash"
            />
          </div>
        </div>
        <div className="smd-field">
          <label className="smd-label">显示名称</label>
          <div className="api-key-input-wrap">
            <input
              className="api-key-input"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="例如：GLM-4V Flash"
            />
          </div>
        </div>
        <div className="smd-field">
          <label className="smd-label">模态</label>
          <select
            className="appearance-select"
            value={modality}
            onChange={e => setModality(e.target.value as typeof modality)}
          >
            <option value="text">文本对话（text）</option>
            <option value="image">图像生成（image）</option>
            <option value="video">视频生成（video）</option>
          </select>
        </div>
        {error && <p className="smd-note" style={{ color: 'var(--text-danger, #dc2626)' }}>{error}</p>}
        <div className="smd-save-row">
          <button className="btn-primary btn-sm" onClick={submit} disabled={saving}>
            {saving ? '创建中...' : '创建模型'}
          </button>
          <button className="btn-secondary btn-sm" onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  )
}

// ------ Left model list ------

function ModelList({
  allModels,
  selectedId,
  settings,
  providers,
  onSelect,
  onAddProvider,
  onAddModel,
}: {
  allModels: LlmModelSummary[]
  selectedId: string | null
  settings: Record<string, string>
  providers: LlmProviderSummary[]
  onSelect: (id: string) => void
  onAddProvider: () => void
  onAddModel: () => void
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

  const isDefault = (m: LlmModelSummary) => {
    const key = DEFAULT_SETTING_KEY[m.modality]
    return key ? settings[key] === m.id : false
  }

  const providerName = useMemo(() => {
    const map = new Map(providers.map(p => [p.id, p.name]))
    return (id: string) => PROVIDER_INFO[id]?.label || map.get(id) || id
  }, [providers])

  return (
    <div className="settings-model-list">
      <div className="sml-toolbar">
        <button className="sml-add-btn" onClick={onAddProvider}>
          <Plus size={11} /> 添加厂商
        </button>
        <button className="sml-add-btn" onClick={onAddModel}>
          <Plus size={11} /> 添加模型
        </button>
      </div>
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
          return (
            <div key={providerId} className="sml-group">
              <div className="sml-group-header">{providerName(providerId)}</div>
              {models.map(m => (
                <button
                  key={m.id}
                  className={cn('sml-item', selectedId === m.id && 'selected', !m.isEnabled && 'disabled')}
                  onClick={() => onSelect(m.id)}
                >
                  <span className="sml-item-label">{m.label}</span>
                  <span className="sml-item-icons">
                    {isDefault(m) && (
                      <Star size={11} className="sml-icon-default" fill="currentColor" />
                    )}
                    {m.isEnabled
                      ? <CircleDot size={11} className="sml-icon-enabled" />
                      : <Circle size={11} className="sml-icon-disabled" />
                    }
                  </span>
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
  const [providers, setProviders] = useState<LlmProviderSummary[]>([])
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>('detail')
  const [newProviderId, setNewProviderId] = useState<string | undefined>(undefined)
  const { settings, updateSetting, updateSettings } = useSettingsStore()
  const {
    textModels: backendTextModels,
    imageModels,
    videoModels,
    loading: modelsLoading,
    loadModels,
  } = useLlmStore()
  const { theme, setTheme } = useUIStore()

  useEffect(() => { loadModels() }, [loadModels])

  useEffect(() => {
    platform.getLlmProviders().then(setProviders).catch(() => {})
  }, [])

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
  const selectedProvider = selectedModel ? providers.find(p => p.id === selectedModel.providerId) : undefined

  useEffect(() => {
    if (!selectedModelId && allModels.length > 0) setSelectedModelId(allModels[0].id)
  }, [allModels, selectedModelId])

  const handleRefresh = () => {
    loadModels()
    platform.getLlmProviders().then(setProviders).catch(() => {})
  }

  const handleSelectModel = (id: string) => {
    setSelectedModelId(id)
    setRightPanelMode('detail')
  }

  const handleProviderCreated = (provider: LlmProviderSummary) => {
    handleRefresh()
    setNewProviderId(provider.id)
    setRightPanelMode('add-model')
  }

  const handleModelCreated = (model: LlmModelSummary) => {
    handleRefresh()
    setSelectedModelId(model.id)
    setRightPanelMode('detail')
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
                  settings={settings}
                  providers={providers}
                  onSelect={handleSelectModel}
                  onAddProvider={() => setRightPanelMode('add-provider')}
                  onAddModel={() => { setNewProviderId(undefined); setRightPanelMode('add-model') }}
                />
                <div className="settings-model-detail-wrap">
                  {rightPanelMode === 'add-provider' && (
                    <AddProviderPanel
                      onCancel={() => setRightPanelMode('detail')}
                      onCreated={handleProviderCreated}
                    />
                  )}
                  {rightPanelMode === 'add-model' && (
                    <AddModelPanel
                      providers={providers}
                      initialProviderId={newProviderId}
                      onCancel={() => setRightPanelMode('detail')}
                      onCreated={handleModelCreated}
                    />
                  )}
                  {rightPanelMode === 'detail' && (
                    selectedModel ? (
                      <ModelDetailPanel
                        key={selectedModel.id}
                        model={selectedModel}
                        provider={selectedProvider}
                        settings={settings}
                        updateSettings={updateSettings}
                        updateSetting={updateSetting}
                        onRefresh={handleRefresh}
                      />
                    ) : (
                      <div className="smd-placeholder">选择左侧模型查看详情</div>
                    )
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
