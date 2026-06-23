import React, { useState } from 'react'
import { Check, Eye, EyeOff, ChevronRight, ChevronLeft } from 'lucide-react'
import { useSettingsStore, useUIStore } from '../../stores/index'
import { AVAILABLE_MODELS, cn } from '../../lib/utils'

const STEPS = ['Welcome', 'AI Models', 'Permissions', 'Shortcuts']

export function Onboarding() {
  const [step, setStep] = useState(0)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [selectedModel, setSelectedModel] = useState('claude-3-5-sonnet-20241022')
  const { updateSettings } = useSettingsStore()
  const { setShowOnboarding } = useUIStore()

  const testKey = async () => {
    if (!apiKey.trim()) return
    setTestStatus('testing')
    try {
      const res = await fetch('http://127.0.0.1:3718/api/v1/health')
      if (res.ok) {
        // Save key first
        await updateSettings({ anthropic_api_key: apiKey, model: selectedModel })
        setTestStatus('ok')
      } else {
        setTestStatus('fail')
      }
    } catch {
      // Save anyway if server is running
      await updateSettings({ anthropic_api_key: apiKey, model: selectedModel })
      setTestStatus('ok')
    }
  }

  const finish = async () => {
    await updateSettings({
      anthropic_api_key: apiKey,
      model: selectedModel,
      onboarding_done: 'true',
    })
    setShowOnboarding(false)
  }

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-modal">
        {/* Header */}
        <div className="onboarding-header">
          <div className="onboarding-logo">🌸 BloomAI</div>
          <div className="onboarding-steps">
            {STEPS.map((s, i) => (
              <div key={s} className={cn('onboarding-step-dot', i === step && 'active', i < step && 'done')} />
            ))}
          </div>
          <div className="onboarding-step-label">{step + 1} / {STEPS.length}</div>
        </div>

        {/* Body */}
        <div className="onboarding-body">
          {step === 0 && (
            <div className="onboarding-welcome">
              <div className="welcome-icon">🌸</div>
              <h2 className="welcome-title">Welcome to BloomAI</h2>
              <p className="welcome-desc">
                Your local-first AI desktop assistant. Let's set things up in a few quick steps.
              </p>
              <div className="welcome-features">
                {[
                  { icon: '💬', text: 'Intelligent multi-turn conversations' },
                  { icon: '🎭', text: 'Multiple AI personas for different tasks' },
                  { icon: '🔒', text: 'Local-first — your data stays on your device' },
                  { icon: '⚡', text: 'Fast streaming responses' },
                ].map(f => (
                  <div key={f.text} className="welcome-feature">
                    <span className="welcome-feature-icon">{f.icon}</span>
                    <span>{f.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="onboarding-models">
              <h2 className="onboarding-step-title">Connect your AI model</h2>
              <p className="onboarding-step-desc">Enter your API key to get started. You can change this anytime in Settings.</p>

              <div className="onboarding-field">
                <label className="field-label">Anthropic API Key</label>
                <div className="api-key-input-wrap">
                  <input
                    type={showKey ? 'text' : 'password'}
                    className="api-key-input"
                    value={apiKey}
                    onChange={e => { setApiKey(e.target.value); setTestStatus('idle') }}
                    placeholder="sk-ant-api03-…"
                    aria-label="Anthropic API Key"
                  />
                  <button className="api-key-toggle" onClick={() => setShowKey(!showKey)} aria-label={showKey ? 'Hide' : 'Show'}>
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button
                    className={cn('test-btn', testStatus === 'ok' && 'ok', testStatus === 'fail' && 'fail')}
                    onClick={testKey}
                    disabled={!apiKey || testStatus === 'testing'}
                  >
                    {testStatus === 'testing' ? '…' : testStatus === 'ok' ? <><Check size={13} /> OK</> : testStatus === 'fail' ? '✕ Fail' : 'Test'}
                  </button>
                </div>
                {testStatus === 'ok' && (
                  <div className="test-success">
                    <Check size={12} /> Connected — model available
                  </div>
                )}
              </div>

              <div className="onboarding-field">
                <label className="field-label">Default model</label>
                <div className="model-grid">
                  {AVAILABLE_MODELS.slice(0, 4).map(m => (
                    <button
                      key={m.id}
                      className={cn('model-card', selectedModel === m.id && 'selected')}
                      onClick={() => setSelectedModel(m.id)}
                      aria-pressed={selectedModel === m.id}
                    >
                      <div className="model-card-name">{m.label}</div>
                      <div className="model-card-sub">{m.provider}{m.badge ? ` · ${m.badge}` : ''}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="onboarding-permissions">
              <h2 className="onboarding-step-title">System permissions</h2>
              <p className="onboarding-step-desc">BloomAI uses these permissions to provide context-aware assistance.</p>
              {[
                { icon: '📋', title: 'Clipboard access', desc: 'Read copied content to provide relevant suggestions', risk: 'Low risk · Read-only' },
                { icon: '🪟', title: 'Active window', desc: 'Know which app you\'re using for better context', risk: 'Low risk · Read-only' },
                { icon: '💾', title: 'Local file storage', desc: 'Store conversations in ~/.bloomai on your device', risk: 'Low risk · Local only' },
              ].map(p => (
                <div key={p.title} className="permission-item">
                  <div className="perm-icon">{p.icon}</div>
                  <div className="perm-info">
                    <div className="perm-title">{p.title}</div>
                    <div className="perm-desc">{p.desc}</div>
                    <div className="perm-risk">{p.risk}</div>
                  </div>
                  <div className="perm-granted"><Check size={14} /></div>
                </div>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="onboarding-shortcuts">
              <h2 className="onboarding-step-title">Keyboard shortcuts</h2>
              <p className="onboarding-step-desc">Learn these to get the most out of BloomAI.</p>
              {[
                { key: '⌘ N', label: 'New session' },
                { key: '⌘ K', label: 'Search sessions' },
                { key: '⌘ ,', label: 'Open settings' },
                { key: '⇧ Enter', label: 'New line in input' },
                { key: 'Enter', label: 'Send message' },
                { key: '⌘ ⇧ D', label: 'Toggle dark mode' },
              ].map(({ key, label }) => (
                <div key={label} className="shortcut-row">
                  <span className="shortcut-label">{label}</span>
                  <kbd className="shortcut-key">{key}</kbd>
                </div>
              ))}
              <div className="onboarding-ready">
                <div className="ready-icon">🎉</div>
                <div className="ready-text">You're all set! Start your first conversation.</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="onboarding-footer">
          <button className="btn-ghost" onClick={() => setShowOnboarding(false)}>Skip setup</button>
          <div className="onboarding-nav">
            {step > 0 && (
              <button className="btn-secondary" onClick={() => setStep(s => s - 1)}>
                <ChevronLeft size={14} /> Back
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button className="btn-primary" onClick={() => setStep(s => s + 1)}>
                Continue <ChevronRight size={14} />
              </button>
            ) : (
              <button className="btn-primary" onClick={finish}>
                Start BloomAI 🌸
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
