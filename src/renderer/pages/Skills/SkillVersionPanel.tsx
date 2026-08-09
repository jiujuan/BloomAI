import React, { useMemo } from 'react'
import { ChevronRight, GitCompare, History, RotateCcw, ShieldCheck } from 'lucide-react'
import type { SkillVersion } from './skill-runtime.types'
import { formatDate, parseJson } from './skill-runtime.types'

export type SkillFileTreeNode = {
  name: string
  path: string
  kind: 'file' | 'directory'
  sha256?: string
  sizeBytes?: number
  children?: SkillFileTreeNode[]
}

export type SkillVersionDiff = {
  added: string[]
  removed: string[]
  changed: string[]
}

export type VersionSelection = {
  current: SkillVersion | undefined
  selected: SkillVersion | undefined
}

export function getVersionSelection(versions: SkillVersion[], currentVersionId?: string, selectedVersionId?: string): VersionSelection {
  const current = versions.find((version) => version.id === currentVersionId) ?? versions[0] ?? undefined
  const selected = (selectedVersionId ? versions.find((version) => version.id === selectedVersionId) : undefined) ?? current
  return { current, selected }
}

export function getVersionState(version: SkillVersion, currentVersionId?: string): 'current' | 'history' {
  return version.id === currentVersionId ? 'current' : 'history'
}

export function getVersionFiles(version: SkillVersion | undefined): Array<{ path: string; sha256: string; sizeBytes: number }> {
  if (!version) return []
  const manifest = version.manifest && typeof version.manifest === 'object' ? version.manifest as Record<string, unknown> : {}
  const sourceSnapshot = version.sourceSnapshot && typeof version.sourceSnapshot === 'object' ? version.sourceSnapshot as Record<string, unknown> : {}
  const parsedManifest = parseJson<Record<string, unknown>>(version.manifest_json, {})
  const parsedSnapshot = parseJson<Record<string, unknown>>(version.source_snapshot_json, {})
  const rawFiles = [manifest.files, sourceSnapshot.files, parsedManifest.files, parsedSnapshot.files].find(Array.isArray)
  if (!Array.isArray(rawFiles)) return []
  return rawFiles
    .map((item) => {
      if (typeof item === 'string') return { path: item, sha256: '', sizeBytes: 0 }
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const path = typeof row.path === 'string' ? row.path : ''
      if (!path) return null
      return { path, sha256: typeof row.sha256 === 'string' ? row.sha256 : '', sizeBytes: typeof row.sizeBytes === 'number' ? row.sizeBytes : typeof row.size_bytes === 'number' ? row.size_bytes : 0 }
    })
    .filter((item): item is { path: string; sha256: string; sizeBytes: number } => Boolean(item))
    .filter((item, index, all) => all.findIndex((candidate) => candidate.path === item.path) === index)
    .sort((a, b) => a.path.localeCompare(b.path))
}

export function buildSkillFileTree(version: SkillVersion | undefined): SkillFileTreeNode[] {
  const root: SkillFileTreeNode[] = []
  for (const file of getVersionFiles(version)) {
    const parts = file.path.split('/').filter(Boolean)
    let nodes = root
    let prefix = ''
    parts.forEach((part, index) => {
      prefix = prefix ? `${prefix}/${part}` : part
      const isFile = index === parts.length - 1
      let node = nodes.find((candidate) => candidate.name === part)
      if (!node) {
        node = { name: part, path: prefix, kind: isFile ? 'file' : 'directory', ...(isFile ? { sha256: file.sha256, sizeBytes: file.sizeBytes } : { children: [] }) }
        nodes.push(node)
      }
      if (!isFile) nodes = node.children ?? (node.children = [])
    })
  }
  return sortTree(root)
}

export function buildSkillVersionDiff(currentVersion: SkillVersion | undefined, targetVersion: SkillVersion | undefined): SkillVersionDiff {
  const current = new Map(getVersionFiles(currentVersion).map((file) => [file.path, file]))
  const target = new Map(getVersionFiles(targetVersion).map((file) => [file.path, file]))
  const added = [...target.keys()].filter((path) => !current.has(path)).sort()
  const removed = [...current.keys()].filter((path) => !target.has(path)).sort()
  const changed = [...target.keys()].filter((path) => {
    const before = current.get(path)
    const after = target.get(path)
    return Boolean(before && after && (before.sha256 !== after.sha256 || before.sizeBytes !== after.sizeBytes))
  }).sort()
  return { added, removed, changed }
}

export function versionSecurityLabel(version: SkillVersion) {
  const status = version.securityStatus || version.security_status || 'unknown'
  if (status === 'verified' || status === 'approved') return '已验证'
  if (status === 'warning' || status === 'pending') return '待审查'
  if (status === 'blocked' || status === 'rejected') return '已阻止'
  return status
}

type SkillVersionPanelProps = {
  versions: SkillVersion[]
  currentVersionId?: string
  selectedVersionId?: string
  onSelect?: (version: SkillVersion) => void
  onPreviewUpdate?: (version: SkillVersion) => void
  onPreviewRollback?: (version: SkillVersion) => void
}

export function SkillVersionPanel({ versions, currentVersionId, selectedVersionId, onSelect, onPreviewUpdate, onPreviewRollback }: SkillVersionPanelProps) {
  const selection = getVersionSelection(versions, currentVersionId, selectedVersionId)
  const selectedState = selection.selected ? getVersionState(selection.selected, selection.current?.id) : 'history'
  const fileTree = useMemo(() => buildSkillFileTree(selection.selected), [selection.selected])
  const diff = useMemo(() => buildSkillVersionDiff(selection.current, selection.selected), [selection.current, selection.selected])
  const hasDiff = Boolean(selection.current && selection.selected && selection.current.id !== selection.selected.id)

  return <section className="skills-center-subpanel" aria-labelledby="skills-version-panel-title">
    <div className="skills-center-subpanel-head"><div><h3 id="skills-version-panel-title">Versions / Diff</h3><p>版本快照不可变；当前版本来自 Installation 指针，历史版本只能查看或进入回滚确认。</p></div><GitCompare size={15} aria-hidden="true" /></div>
    {versions.length === 0 ? <p className="skills-muted">尚无版本记录。</p> : <div className="skills-center-version-list" role="list" aria-label="Skill 版本列表">{versions.map((version) => {
      const state = getVersionState(version, selection.current?.id)
      const isSelected = version.id === selection.selected?.id
      return <button type="button" role="listitem" key={version.id} className={'skills-center-version-row ' + (isSelected ? 'selected' : '')} aria-current={state === 'current' ? 'true' : undefined} aria-pressed={isSelected} onClick={() => onSelect?.(version)}>
        <span><strong>v{version.version}</strong><small>{state === 'current' ? '当前版本' : '历史版本'} · {formatDate(version.publishedAt || version.createdAt)} · {version.runtime}</small></span>
        <span><span className={'skills-status ' + (version.isCompatible ? 'success' : 'danger')}>{version.isCompatible ? '兼容' : '不兼容'}</span><small className="skills-center-mono">{versionSecurityLabel(version)} · {(version.manifestHash || version.manifest_hash || '—').slice(0, 10)}</small></span>
      </button>
    })}</div>}
    {selection.selected && <>
      <div className="skills-version-selection-summary"><div><span className="skills-eyebrow">查看版本</span><strong>v{selection.selected.version} · {selectedState === 'current' ? '当前版本' : '历史版本'}</strong></div><div className="skills-chip-row"><span className="skills-chip">Runtime: {selection.selected.runtime}</span><span className="skills-chip">安全：{versionSecurityLabel(selection.selected)}</span><span className="skills-chip skills-center-mono">snapshot: {(selection.selected.snapshotHash || selection.selected.snapshot_hash || selection.selected.immutableHash || '—').slice(0, 12)}</span></div></div>
      <section className="skills-version-files" aria-labelledby="skills-version-files-title"><div className="skills-detail-heading"><h4 id="skills-version-files-title">文件树</h4><span className="skills-muted">{getVersionFiles(selection.selected).length} 个文件</span></div>{fileTree.length === 0 ? <p className="skills-muted">该版本没有可用文件清单。</p> : <ul className="skills-file-tree">{fileTree.map((node) => <FileTreeNodeView key={node.path} node={node} />)}</ul>}</section>
      <section className="skills-version-diff" aria-labelledby="skills-version-diff-title"><div className="skills-detail-heading"><h4 id="skills-version-diff-title">Diff</h4>{hasDiff && <span className="skills-muted">v{selection.current?.version} → v{selection.selected.version}</span>}</div>{!hasDiff ? <p className="skills-muted">当前版本没有待比较的历史快照。</p> : <div className="skills-version-diff-grid"><DiffList label="新增" tone="success" items={diff.added} /><DiffList label="删除" tone="danger" items={diff.removed} /><DiffList label="变更" tone="warning" items={diff.changed} /></div>}</section>
      <div className="skills-version-actions">{selectedState === 'history' && onPreviewRollback && <button type="button" className="skills-button secondary" onClick={() => onPreviewRollback(selection.selected!)}><RotateCcw size={14} />查看回滚影响</button>}{onPreviewUpdate && <button type="button" className="skills-button secondary" onClick={() => onPreviewUpdate(selection.selected!)}><History size={14} />创建更新 Draft</button>}</div>
    </>}
    <div className="skills-center-inline-note"><ShieldCheck size={14} aria-hidden="true" /> Manifest、source SHA、安全状态和文件清单来自 server snapshot；历史版本不会被标成 current。</div>
  </section>
}

function FileTreeNodeView({ node }: { node: SkillFileTreeNode }) {
  return <li className={node.kind === 'directory' ? 'directory' : 'file'}><span><ChevronRight size={13} aria-hidden="true" />{node.name}</span>{node.kind === 'file' && <small className="skills-center-mono">{node.sizeBytes ?? 0} B · {(node.sha256 || '—').slice(0, 10)}</small>}{node.children && node.children.length > 0 && <ul>{node.children.map((child) => <FileTreeNodeView key={child.path} node={child} />)}</ul>}</li>
}

function DiffList({ label, tone, items }: { label: string; tone: 'success' | 'danger' | 'warning'; items: string[] }) {
  return <div className="skills-version-diff-list"><div className="skills-detail-heading"><strong>{label}</strong><span className={'skills-status ' + tone}>{items.length}</span></div>{items.length === 0 ? <span className="skills-muted">无</span> : <ul>{items.map((item) => <li key={item} className="skills-center-mono">{item}</li>)}</ul>}</div>
}

function sortTree(nodes: SkillFileTreeNode[]): SkillFileTreeNode[] {
  return nodes.sort((a, b) => (a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === 'file' ? -1 : 1)).map((node) => node.children ? { ...node, children: sortTree(node.children) } : node)
}
