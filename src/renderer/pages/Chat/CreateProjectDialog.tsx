import React, { useEffect, useState } from 'react'
import { FolderOpen, X } from 'lucide-react'
import { platform } from '@renderer/api'
import { useProjectStore } from '@renderer/store'

export function directoryBaseName(value: string): string {
  return value.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || value
}

export function isValidProjectName(value: string): boolean {
  const normalized = value.trim()
  return normalized.length >= 1 && normalized.length <= 80
}

export function directoryValueAfterSelection(
  current: string | undefined,
  selected: { canceled: boolean; path?: string },
): string | undefined {
  return !selected.canceled && selected.path ? selected.path : current
}

export function CreateProjectDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (projectId: string) => void }) {
  const { createProject } = useProjectStore()
  const [name, setName] = useState('')
  const [sourceDirectory, setSourceDirectory] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const normalizedName = name.trim()
  const valid = isValidProjectName(name)

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !submitting) onClose() }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose, submitting])

  if (!open) return null
  const selectDirectory = async () => {
    setError(null)
    try {
      const selected = await platform.selectDirectory()
      setSourceDirectory((current) => directoryValueAfterSelection(current, selected))
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : '无法打开目录选择器')
    }
  }
  const submit = async () => {
    if (!valid || submitting) return
    setSubmitting(true); setError(null)
    try {
      const created = await createProject({ name: normalizedName, ...(sourceDirectory ? { sourceDirectory } : {}) })
      onCreated(created.project.id)
      setName(''); setSourceDirectory(undefined)
      onClose()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '创建项目失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return <div className="modal-overlay" onClick={() => !submitting && onClose()}>
    <div className="modal create-project-modal" role="dialog" aria-modal="true" aria-labelledby="create-project-title" onClick={(event) => event.stopPropagation()}>
      <div className="create-project-header"><h2 className="modal-title" id="create-project-title">创建项目</h2><button className="sidebar-icon-button" disabled={submitting} aria-label="关闭" onClick={onClose}><X size={17} /></button></div>
      <label className="session-title-field"><span>项目名称</span><input value={name} autoFocus maxLength={80} aria-invalid={!!error && !valid} className="session-title-input" onChange={(event) => { setName(event.target.value); setError(null) }} onKeyDown={(event) => { if (event.key === 'Enter') void submit() }} /></label>
      <button className="directory-selector" type="button" onClick={() => void selectDirectory()} disabled={submitting}><FolderOpen size={18} /><span>{sourceDirectory ? '更换源文件夹' : '选择源文件夹（可选）'}</span></button>
      {sourceDirectory ? <div className="selected-directory"><strong>{directoryBaseName(sourceDirectory)}</strong><span title={sourceDirectory}>{sourceDirectory}</span></div> : <p className="directory-help">未选择时，BloomAI 会在数据目录的 workspaces 文件夹中自动创建 NewProjectN。</p>}
      {error && <div className="session-title-error" role="alert">{error}</div>}
      <div className="modal-actions"><button className="btn-secondary" disabled={submitting} onClick={onClose}>取消</button><button className="btn-primary" disabled={!valid || submitting} onClick={() => void submit()}>{submitting ? '创建中...' : '创建'}</button></div>
    </div>
  </div>
}