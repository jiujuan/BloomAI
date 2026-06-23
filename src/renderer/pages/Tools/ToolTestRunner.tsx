import React, { useState } from 'react'
import { X, Play, Copy, Check } from 'lucide-react'
import { useToolsStore, Tool } from '@renderer/pages/Tools/tools.store'

export function ToolTestRunner({ tool, onClose }: { tool: Tool; onClose: () => void }) {
  const { runTool } = useToolsStore()
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  let params: Record<string, any> = {}
  try { params = JSON.parse(tool.params_schema) } catch {}

  const run = async () => {
    setRunning(true); setError(null); setResult(null)
    try {
      const parsedInput: Record<string, any> = {}
      for (const [key, val] of Object.entries(inputs)) {
        const schema = params[key]
        if (schema?.type === 'number') parsedInput[key] = parseFloat(val) || 0
        else if (schema?.type === 'boolean') parsedInput[key] = val === 'true'
        else if (schema?.type === 'array' || schema?.type === 'object') { try { parsedInput[key] = JSON.parse(val) } catch { parsedInput[key] = val } }
        else parsedInput[key] = val
      }
      const data = await runTool(tool.id, parsedInput)
      setResult(data)
    } catch (e: any) { setError(e.message) }
    setRunning(false)
  }

  const copy = () => { navigator.clipboard.writeText(JSON.stringify(result, null, 2)); setCopied(true); setTimeout(() => setCopied(false), 1500) }

  return (
    <div className="runner-overlay" onClick={onClose}>
      <div className="runner-modal" onClick={e => e.stopPropagation()}>
        <div className="runner-head">
          <span className="runner-icon">🔧</span>
          <span className="runner-name">{tool.id}</span>
          <span className="runner-sub">Manual test run</span>
          <button className="runner-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="runner-body">
          <div className="runner-left">
            {Object.entries(params).map(([key, schema]: [string, any]) => (
              <div key={key} className="runner-field">
                <div className="runner-field-label">{key} <span className="runner-field-type">{schema.type}{schema.default !== undefined ? ` · default ${schema.default}` : ''}</span></div>
                {schema.enum ? (
                  <select className="runner-input" value={inputs[key] || schema.default || ''} onChange={e => setInputs(s => ({ ...s, [key]: e.target.value }))}>
                    {schema.enum.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                ) : (
                  <input className="runner-input" value={inputs[key] ?? ''} onChange={e => setInputs(s => ({ ...s, [key]: e.target.value }))} placeholder={schema.description || `Enter ${key}…`} />
                )}
              </div>
            ))}
            <button className="runner-run-btn" onClick={run} disabled={running}><Play size={13} /> {running ? 'Running…' : 'Run'}</button>
          </div>
          <div className="runner-right">
            {error && <div className="runner-status error">✕ {error}</div>}
            {result && !error && (
              <>
                <div className="runner-status ok"><Check size={13} /> Success</div>
                <div className="runner-output-label">
                  <span>Output</span>
                  <button className="runner-copy" onClick={copy}>{copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy'}</button>
                </div>
                <pre className="runner-output">{JSON.stringify(result, null, 2)}</pre>
              </>
            )}
            {!result && !error && !running && <div className="runner-placeholder">Fill in parameters and click Run</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
