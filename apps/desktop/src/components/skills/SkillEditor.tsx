import React, { useState } from 'react'
import { X, Save } from 'lucide-react'
import { useSkillsStore } from '../../stores/skills.store'

type SkillType = 'js-function' | 'http-api' | 'prompt-template'

const TEMPLATES: Record<SkillType, string> = {
  'js-function': 'function run(input) {\n  // input is the params object\n  return { result: input }\n}',
  'http-api': '{\n  "url": "https://api.example.com/search?q={{query}}",\n  "method": "GET"\n}',
  'prompt-template': 'Summarize the following text in 3 bullet points:\n\n{{text}}'
}

export function SkillEditor({ onClose }: { onClose: () => void }) {
  const { createSkill } = useSkillsStore()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<SkillType>('prompt-template')
  const [source, setSource] = useState(TEMPLATES['prompt-template'])
  const [paramsSchema, setParamsSchema] = useState('{"text":{"type":"string","description":"Input text"}}')
  const [saving, setSaving] = useState(false)

  const handleTypeChange = (t: SkillType) => { setType(t); setSource(TEMPLATES[t]) }

  const handleSave = async () => {
    if (!name || !description || !source) return
    setSaving(true)
    try { await createSkill({ name, description, type, source, params_schema: paramsSchema }); onClose() }
    catch (e) { console.error(e) }
    setSaving(false)
  }

  return (
    <div className="editor-overlay" onClick={onClose}>
      <div className="skill-editor-modal" onClick={e => e.stopPropagation()}>
        <div className="editor-head">
          <span className="editor-title">New Skill</span>
          <button className="editor-close" onClick={onClose}><X size={14} /></button>
        </div>

        <div className="editor-body">
          <div className="editor-row">
            <div className="editor-field" style={{ flex: 1 }}>
              <label className="editor-label">Name</label>
              <input className="editor-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Keyword Extractor" />
            </div>
            <div className="editor-field" style={{ width: 180 }}>
              <label className="editor-label">Type</label>
              <select className="editor-select" value={type} onChange={e => handleTypeChange(e.target.value as SkillType)}>
                <option value="prompt-template">Prompt Template</option>
                <option value="js-function">JS Function</option>
                <option value="http-api">HTTP API</option>
              </select>
            </div>
          </div>

          <div className="editor-field">
            <label className="editor-label">Description</label>
            <input className="editor-input" value={description} onChange={e => setDescription(e.target.value)} placeholder="What does this skill do?" />
          </div>

          <div className="editor-field">
            <label className="editor-label">{type === 'js-function' ? 'JavaScript Source' : type === 'http-api' ? 'API Config (JSON)' : 'Prompt Template'}</label>
            <textarea className="editor-textarea code" value={source} onChange={e => setSource(e.target.value)} rows={8} />
            <div className="editor-hint">
              {type === 'js-function' && 'Define a function run(input) that returns an object.'}
              {type === 'http-api' && 'Use {{paramName}} for URL template substitution.'}
              {type === 'prompt-template' && 'Use {{paramName}} for variable substitution in the prompt.'}
            </div>
          </div>

          <div className="editor-field">
            <label className="editor-label">Parameters Schema (JSON)</label>
            <textarea className="editor-textarea code small" value={paramsSchema} onChange={e => setParamsSchema(e.target.value)} rows={3} />
          </div>
        </div>

        <div className="editor-foot">
          <button className="editor-btn" onClick={onClose}>Cancel</button>
          <button className="editor-btn primary" onClick={handleSave} disabled={!name || !description || saving}>
            <Save size={13} /> {saving ? 'Saving…' : 'Create Skill'}
          </button>
        </div>
      </div>
    </div>
  )
}
