import React, { useState, useEffect } from 'react'
import { Plus, Trash2, Save, Copy } from 'lucide-react'
import { usePersonaStore } from '@renderer/store'
import { PERSONA_COLORS, AVAILABLE_MODELS, cn } from '@renderer/utils'
import type { Persona } from '@shared/schemas'

export function PersonasPage() {
  const { personas, activePersonaId, setActivePersona, createPersona, updatePersona, deletePersona } = usePersonaStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', system_prompt: '', model_override: '' })
  const [saved, setSaved] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState({ name: '', system_prompt: '', model_override: 'claude-3-5-sonnet-20241022' })

  const selected = personas.find(p => p.id === selectedId)

  useEffect(() => {
    if (personas.length > 0 && !selectedId) {
      setSelectedId(personas[0].id)
    }
  }, [personas])

  useEffect(() => {
    if (selected) {
      setForm({
        name: selected.name,
        system_prompt: selected.system_prompt,
        model_override: selected.model_override || '',
      })
    }
  }, [selectedId, selected?.id])

  const handleSave = async () => {
    if (!selectedId || !selected?.is_builtin === false) return
    // Can only edit non-builtin personas this way — for builtins just show info
    await updatePersona(selectedId, form)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const handleCreate = async () => {
    if (!newForm.name || !newForm.system_prompt) return
    await createPersona(newForm)
    setShowNew(false)
    setNewForm({ name: '', system_prompt: '', model_override: 'claude-3-5-sonnet-20241022' })
  }

  const handleDelete = async (id: string) => {
    if (window.confirm('Delete this persona?')) {
      await deletePersona(id)
      setSelectedId(personas.filter(p => p.id !== id)[0]?.id || null)
    }
  }

  return (
    <div className="personas-page">
      <div className="personas-layout">
        <div className="personas-list-panel">
          <div className="personas-list-header">
            <span className="personas-list-title">Personas</span>
            <button className="btn-icon" onClick={() => setShowNew(true)} title="New persona" aria-label="New persona">
              <Plus size={15} />
            </button>
          </div>
          {personas.map(p => (
            <button
              key={p.id}
              className={cn('persona-list-item', selectedId === p.id && 'active')}
              onClick={() => setSelectedId(p.id)}
            >
              <span
                className="persona-list-avatar"
                style={{ background: PERSONA_COLORS[p.id] || '#888' }}
              >
                {p.name[0]}
              </span>
              <div className="persona-list-info">
                <span className="persona-list-name">{p.name}</span>
                {!!p.is_builtin && <span className="persona-builtin-badge">Built-in</span>}
              </div>
            </button>
          ))}
        </div>

        <div className="personas-editor">
          {selected ? (
            <>
              <div className="personas-editor-header">
                <span
                  className="personas-editor-avatar"
                  style={{ background: PERSONA_COLORS[selected.id] || '#888' }}
                >
                  {selected.name[0]}
                </span>
                <span className="personas-editor-name">{selected.name}</span>
                {!!selected.is_builtin && <span className="persona-builtin-badge">Built-in</span>}
                <div style={{ flex: 1 }} />
                {!selected.is_builtin && (
                  <>
                    <button className="btn-secondary" onClick={handleSave}>
                      {saved ? <><Save size={13} /> Saved!</> : <><Save size={13} /> Save</>}
                    </button>
                    <button className="btn-danger-sm" onClick={() => handleDelete(selected.id)}>
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>

              <div className="editor-field">
                <label className="field-label">Name</label>
                <input
                  className="field-input"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  disabled={!!selected.is_builtin}
                  aria-label="Persona name"
                />
              </div>

              <div className="editor-field">
                <label className="field-label">System Prompt</label>
                <textarea
                  className="field-textarea"
                  value={form.system_prompt}
                  onChange={e => setForm(f => ({ ...f, system_prompt: e.target.value }))}
                  disabled={!!selected.is_builtin}
                  rows={8}
                  aria-label="System prompt"
                />
                <div className="field-hint">
                  Variables: <code>{'{{activeApp}}'}</code> <code>{'{{clipboardContent}}'}</code>
                </div>
              </div>

              <div className="editor-field">
                <label className="field-label">Default Model Override</label>
                <select
                  className="field-select"
                  value={form.model_override}
                  onChange={e => setForm(f => ({ ...f, model_override: e.target.value }))}
                  disabled={!!selected.is_builtin}
                  aria-label="Model override"
                >
                  <option value="">Use session default</option>
                  {AVAILABLE_MODELS.map(m => (
                    <option key={m.id} value={m.id}>{m.label} — {m.provider}</option>
                  ))}
                </select>
              </div>

              <div className="editor-field">
                <button
                  className={cn('btn-primary', activePersonaId === selected.id && 'active')}
                  onClick={() => setActivePersona(selected.id)}
                >
                  {activePersonaId === selected.id ? '✓ Active Persona' : 'Set as Active'}
                </button>
              </div>
            </>
          ) : (
            <div className="personas-empty">Select a persona to edit</div>
          )}
        </div>
      </div>

      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">New Persona</h2>
            <div className="editor-field">
              <label className="field-label">Name</label>
              <input
                className="field-input"
                value={newForm.name}
                onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Research Assistant"
                autoFocus
                aria-label="Persona name"
              />
            </div>
            <div className="editor-field">
              <label className="field-label">System Prompt</label>
              <textarea
                className="field-textarea"
                value={newForm.system_prompt}
                onChange={e => setNewForm(f => ({ ...f, system_prompt: e.target.value }))}
                placeholder="You are a helpful AI assistant specialized in…"
                rows={6}
                aria-label="System prompt"
              />
            </div>
            <div className="editor-field">
              <label className="field-label">Model</label>
              <select
                className="field-select"
                value={newForm.model_override}
                onChange={e => setNewForm(f => ({ ...f, model_override: e.target.value }))}
                aria-label="Model"
              >
                {AVAILABLE_MODELS.map(m => (
                  <option key={m.id} value={m.id}>{m.label} — {m.provider}</option>
                ))}
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowNew(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleCreate} disabled={!newForm.name || !newForm.system_prompt}>
                Create Persona
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
