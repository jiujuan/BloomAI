import React, { useEffect, useState } from 'react'
import { ArrowLeft, Play, Check } from 'lucide-react'
import { useToolsStore } from '@renderer/pages/Tools/tools.store'
import { ToolTestRunner } from './ToolTestRunner'
import { cn } from '@renderer/utils'

export function ToolDetailPage({ toolId, onBack }: { toolId: string; onBack: () => void }) {
  const { tools, toolRuns, loadRuns } = useToolsStore()
  const tool = tools.find(t => t.id === toolId)
  const [showRunner, setShowRunner] = useState(false)

  useEffect(() => { loadRuns() }, [])

  if (!tool) return <div className="tool-detail-page"><button onClick={onBack}><ArrowLeft size={14} /> Back</button></div>

  let params: Record<string, any> = {}
  let result: Record<string, any> = {}
  try { params = JSON.parse(tool.params_schema) } catch {}
  try { result = JSON.parse(tool.result_schema) } catch {}

  const runsForTool = toolRuns.filter(r => r.tool_id === toolId).slice(0, 10)

  return (
    <div className="tool-detail-page">
      <div className="td-topbar">
        <button className="td-back" onClick={onBack}><ArrowLeft size={14} /></button>
        <div className="td-breadcrumb">Tools <span>/</span> {tool.category} <span>/</span> <b>{tool.id}</b></div>
        <button className="td-btn" onClick={() => setShowRunner(true)}><Play size={13} /> Test Run</button>
      </div>

      <div className="td-hero">
        <div className="td-hero-icon">🔧</div>
        <div className="td-hero-info">
          <div className="td-hero-name">{tool.id}</div>
          <div className="td-hero-desc">{tool.description}</div>
          <div className="td-tags">
            <span className="td-tag">{tool.category}</span>
            {tool.requires_permission && <span className="td-tag perm">{tool.requires_permission} permission</span>}
            <span className="td-tag">{tool.is_builtin ? 'built-in' : 'custom'}</span>
          </div>
        </div>
        <div className={cn('td-enabled-badge', tool.is_enabled ? 'ok' : 'off')}>
          {tool.is_enabled ? <><Check size={12} /> Enabled</> : 'Disabled'}
        </div>
      </div>

      <div className="td-body">
        <div className="td-section">
          <div className="td-section-title">Input Parameters</div>
          <div className="td-schema-block">
            {Object.entries(params).map(([key, schema]: [string, any]) => (
              <div key={key} className="td-schema-row">
                <div className="td-schema-left">
                  <div className="td-schema-name">{key}</div>
                  <div className="td-schema-type">{schema.type}{schema.default !== undefined ? ` · default ${JSON.stringify(schema.default)}` : ''}</div>
                </div>
                <div className="td-schema-right">
                  <span className="td-schema-desc">{schema.description || (schema.enum ? `Options: ${schema.enum?.join(', ')}` : '')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="td-section">
          <div className="td-section-title">Output Schema</div>
          <div className="td-schema-block">
            {Object.entries(result).map(([key, schema]: [string, any]) => (
              <div key={key} className="td-schema-row">
                <div className="td-schema-left">
                  <div className="td-schema-name">{key}</div>
                  <div className="td-schema-type">{schema.type}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="td-section">
          <div className="td-section-title">Recent Runs</div>
          <div className="td-run-list">
            {runsForTool.length === 0 && <div className="td-empty">No runs yet</div>}
            {runsForTool.map(r => (
              <div key={r.id} className="td-run-item">
                <span className={cn('td-run-pill', r.status)}>{r.status === 'success' ? <Check size={10} /> : '✕'} {r.status}</span>
                <span className="td-run-input">{r.input_json.slice(0, 60)}</span>
                <span className="td-run-dur">{r.duration_ms}ms</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showRunner && <ToolTestRunner tool={tool} onClose={() => setShowRunner(false)} />}
    </div>
  )
}
