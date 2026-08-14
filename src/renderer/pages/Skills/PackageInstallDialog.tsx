import React, { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Code2, FolderOpen, Github, Info, LoaderCircle, PackageOpen, ShieldAlert, ShieldCheck, X } from 'lucide-react'
import { platform } from '@renderer/api'
import { useSkillRuntimeStore } from './skill-runtime.store'
import type { InspectedPackage, PackageImportReview, PackageImportReviewStatus, PackageInspectionResult, PackageInstallInput, PackageSource } from './skill-runtime.types'

export type ImportSourceKind = 'github' | 'local-directory' | 'zip' | 'npx'

export type PackageSourceInput = {
  repositoryUrl?: string
  ref?: string
  subdirectory?: string
  directory?: string
  artifactPath?: string
}

export type PackageImportAuditContext = {
  packageId?: string
  reviewId: string
  sourceFingerprint: string
  source: PackageSource
  result: Record<string, unknown>
}

type ImportPhase = 'choose' | 'inspecting' | 'review' | 'approving' | 'rejecting' | 'installing' | 'completed'
type StatusTone = 'success' | 'info' | 'warning' | 'danger' | 'muted'

const SOURCE_LABELS: Record<ImportSourceKind, string> = {
  github: 'GitHub',
  'local-directory': '本地目录',
  zip: 'ZIP',
  npx: 'npx 产物',
}

const PHASES: Array<{ id: 'choose' | 'review' | 'confirm'; label: string }> = [
  { id: 'choose', label: '选择来源' },
  { id: 'review', label: '解析和扫描' },
  { id: 'confirm', label: '确认安装' },
]

function trim(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isGithubRepositoryUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash) return false
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length !== 2) return false
    return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(parts[0]) && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(parts[1].replace(/\.git$/, ''))
  } catch {
    return false
  }
}

export function validatePackageSourceInput(kind: ImportSourceKind, input: PackageSourceInput): string[] {
  const errors: string[] = []
  if (kind === 'github') {
    if (!isGithubRepositoryUrl(trim(input.repositoryUrl))) errors.push('请输入有效的 GitHub 仓库 URL。')
    if (!trim(input.ref)) errors.push('请输入 Git ref、tag 或 commit。')
  }
  if (kind === 'local-directory' && !trim(input.directory)) errors.push('请输入本地目录路径。')
  if (kind === 'zip' && !trim(input.artifactPath)) errors.push('请输入 ZIP 产物路径。')
  if (kind === 'zip' && trim(input.artifactPath) && !/\.zip$/i.test(trim(input.artifactPath))) errors.push('ZIP 产物必须使用 .zip 扩展名。')
  if (kind === 'npx' && !trim(input.artifactPath)) errors.push('请输入已生成的 npx 产物目录。')
  if (trim(input.subdirectory).split('/').some((segment) => segment === '..')) errors.push('Skill 子目录不能越过来源根目录。')
  return errors
}

export function buildPackageSource(kind: ImportSourceKind, input: PackageSourceInput): PackageSource | null {
  const errors = validatePackageSourceInput(kind, input)
  if (errors.length > 0) return null
  const subdirectory = trim(input.subdirectory)
  const withSubdirectory = <T extends PackageSource>(source: T) => subdirectory ? { ...source, subdirectory } as T : source
  if (kind === 'github') return withSubdirectory({ kind: 'github-archive', repositoryUrl: trim(input.repositoryUrl), ref: trim(input.ref) || 'main' })
  if (kind === 'zip') return withSubdirectory({ kind: 'zip', zipPath: trim(input.artifactPath) })
  if (kind === 'npx') {
    const artifactPath = trim(input.artifactPath)
    return withSubdirectory(/\.zip$/i.test(artifactPath)
      ? { kind: 'zip', zipPath: artifactPath, metadata: { origin: 'npx-artifact' } }
      : { kind: 'local-directory', directory: artifactPath, metadata: { origin: 'npx-artifact' } })
  }
  return withSubdirectory({ kind: 'local-directory', directory: trim(input.directory) })
}

export function getImportReviewTone(status: PackageImportReviewStatus | undefined): StatusTone {
  if (status === 'approved' || status === 'installed') return 'success'
  if (status === 'warning' || status === 'pending') return 'warning'
  if (status === 'rejected') return 'danger'
  if (status === 'scanning' || status === 'validated') return 'info'
  return 'muted'
}

export function canInstallImportReview(review: PackageImportReview | null | undefined) {
  return review?.status === 'approved' || review?.status === 'installed'
}

function statusLabel(status: PackageImportReviewStatus | undefined) {
  if (!status) return '尚未扫描'
  const labels: Record<string, string> = { scanning: '扫描中', validated: '已验证', warning: '需要关注', pending: '等待审批', approved: '已批准', rejected: '已拒绝', installed: '已安装' }
  return labels[status] || status
}

function phaseIndex(phase: ImportPhase) {
  if (phase === 'choose') return 0
  if (phase === 'inspecting' || phase === 'review' || phase === 'approving' || phase === 'rejecting') return 1
  return 2
}

function sourceDescription(source: PackageSource | null) {
  if (!source) return '尚未生成 source snapshot。'
  if (source.kind === 'github-archive') return `${source.repositoryUrl} @ ${source.ref}`
  if (source.kind === 'zip') return source.zipPath
  return source.directory
}

function asPackageId(result: PackageImportAuditContext['result']) {
  const packageValue = result.package
  if (packageValue && typeof packageValue === 'object' && typeof (packageValue as { id?: unknown }).id === 'string') return (packageValue as { id: string }).id
  if (typeof result.packageId === 'string') return result.packageId
  const first = Array.isArray(result.packages) ? result.packages[0] : null
  return first && typeof first === 'object' && typeof (first as { packageId?: unknown }).packageId === 'string' ? (first as { packageId: string }).packageId : undefined
}

export type PackageInstallDialogProps = {
  onClose: () => void
  onInstalled?: (context: PackageImportAuditContext) => void
  initialInspection?: PackageInspectionResult
  initialReview?: PackageImportReview
  mode?: 'dialog' | 'page'
}

const IMPORT_SOURCE_TABS: Array<{ kind: Exclude<ImportSourceKind, 'zip'>; label: string; description: string }> = [
  { kind: 'github', label: 'GitHub Archive', description: '按 ref 生成不可变快照' },
  { kind: 'local-directory', label: '本地目录', description: '导入真实 SKILL.md 目录' },
  { kind: 'npx', label: 'npx skills 产物', description: '导入 --copy 生成的目录' },
]

function importSourceIcon(kind: Exclude<ImportSourceKind, 'zip'>) {
  if (kind === 'github') return <Github size={16} aria-hidden="true" />
  if (kind === 'local-directory') return <FolderOpen size={16} aria-hidden="true" />
  return <Code2 size={16} aria-hidden="true" />
}

function directoryPathFromDrop(event: React.DragEvent<HTMLDivElement>) {
  const file = event.dataTransfer.files[0] as (File & { path?: string; webkitRelativePath?: string }) | undefined
  if (!file?.path) return ''
  const filePath = file.path
  const relativePath = file.webkitRelativePath?.replace(/^[\\/]+/, '')
  if (!relativePath) return filePath
  const normalizedFilePath = filePath.replace(/\\/g, '/')
  const normalizedRelativePath = relativePath.replace(/\\/g, '/')
  return normalizedFilePath.endsWith(`/${normalizedRelativePath}`)
    ? normalizedFilePath.slice(0, -normalizedRelativePath.length).replace(/[\\/]$/, '')
    : filePath
}

export function PackageInstallDialog({ onClose, onInstalled, initialInspection, initialReview, mode = 'dialog' }: PackageInstallDialogProps) {
  const { inspectPackage, getImportReview, approveImportReview, rejectImportReview, installPackage } = useSkillRuntimeStore()
  const [sourceKind, setSourceKind] = useState<ImportSourceKind>('github')
  const [sourceInput, setSourceInput] = useState<PackageSourceInput>({ repositoryUrl: 'https://github.com/jimliu/baoyu-skills', ref: 'main' })
  const [source, setSource] = useState<PackageSource | null>(null)
  const [inspection, setInspection] = useState<PackageInspectionResult | null>(initialInspection ?? null)
  const [review, setReview] = useState<PackageImportReview | null>(initialReview ?? null)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [phase, setPhase] = useState<ImportPhase>(initialInspection ? 'review' : 'choose')

  const packages = inspection?.packages ?? []
  const ignoredPaths = useMemo(() => [...new Set(packages.flatMap((item) => item.sourceSnapshot.ignoredPaths ?? []).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [packages])
  const busy = phase === 'inspecting' || phase === 'approving' || phase === 'rejecting' || phase === 'installing'
  const validationErrors = useMemo(() => validatePackageSourceInput(sourceKind, sourceInput), [sourceInput, sourceKind])
  const canInstall = Boolean(source && inspection?.reviewId && inspection.sourceFingerprint && canInstallImportReview(review))
  const currentStep = phaseIndex(phase)

  const updateInput = (patch: Partial<PackageSourceInput>) => {
    setSourceInput((current) => ({ ...current, ...patch }))
    setError(null)
    if (phase !== 'choose') {
      setPhase('choose')
      setInspection(null)
      setReview(null)
      setSource(null)
    }
  }

  const switchSource = (nextKind: Exclude<ImportSourceKind, 'zip'>) => {
    setSourceKind(nextKind)
    setError(null)
    if (phase !== 'choose') {
      setPhase('choose')
      setInspection(null)
      setReview(null)
      setSource(null)
    }
  }

  const chooseDirectory = async () => {
    setError(null)
    try {
      const selected = await platform.selectDirectory()
      if (!selected.canceled && selected.path) updateInput({ directory: selected.path })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法打开目录选择器。')
    }
  }

  const handleDirectoryDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const directory = directoryPathFromDrop(event)
    if (!directory) {
      setError('无法读取拖入目录路径，请使用“选择目录”按钮。')
      return
    }
    updateInput({ directory })
  }

  const inspect = async () => {
    const errors = validatePackageSourceInput(sourceKind, sourceInput)
    if (errors.length > 0) { setError(errors[0]); return }
    const nextSource = buildPackageSource(sourceKind, sourceInput)
    if (!nextSource) { setError('无法生成安全的 Package source。'); return }
    setSource(nextSource)
    setError(null)
    setPhase('inspecting')
    try {
      const result = await inspectPackage(nextSource)
      setInspection(result)
      const nextReview = result.reviewId ? await getImportReview(result.reviewId) : null
      setReview(nextReview)
      setPhase('review')
    } catch (cause) {
      setPhase('choose')
      setError(cause instanceof Error ? cause.message : '检查 Package 失败。')
    }
  }

  const approve = async () => {
    if (!review?.id) return
    setError(null)
    setPhase('approving')
    try {
      setReview(await approveImportReview(review.id))
      setPhase('review')
    } catch (cause) {
      setPhase('review')
      setError(cause instanceof Error ? cause.message : '批准 Import Review 失败。')
    }
  }

  const reject = async () => {
    if (!review?.id) return
    const decisionReason = trim(reason)
    if (!decisionReason) { setError('拒绝导入前请填写原因。'); return }
    setError(null)
    setPhase('rejecting')
    try {
      setReview(await rejectImportReview(review.id, decisionReason))
      setPhase('review')
    } catch (cause) {
      setPhase('review')
      setError(cause instanceof Error ? cause.message : '拒绝 Import Review 失败。')
    }
  }

  const install = async () => {
    if (!source || !inspection || !review || !canInstallImportReview(review)) return
    if (typeof window !== 'undefined' && !window.confirm(`确认安装已批准的 ${packages.length} 个 Package Skill？安装会固定 source fingerprint，并按 manifest 请求权限；不会自动授予能力。`)) return
    setError(null)
    setPhase('installing')
    const input: PackageInstallInput = { source, reviewId: inspection.reviewId, sourceFingerprint: inspection.sourceFingerprint, confirm: true }
    try {
      const result = await installPackage(input)
      const context: PackageImportAuditContext = { packageId: asPackageId(result as Record<string, unknown>), reviewId: inspection.reviewId, sourceFingerprint: inspection.sourceFingerprint, source, result: result as Record<string, unknown> }
      setPhase('completed')
      onInstalled?.(context)
      if (mode === 'dialog') onClose()
    } catch (cause) {
      setPhase('review')
      setError(cause instanceof Error ? cause.message : '安装 Package 失败。')
    }
  }

  const activeStatus = review?.status
  const stepper = <ol className="skills-import-stepper" aria-label="Skill 导入流程">
    {PHASES.map((item, index) => <li key={item.id} className={index < currentStep ? 'complete' : index === currentStep ? 'active' : 'pending'}><span aria-hidden="true">{index < currentStep ? '✓' : index + 1}</span><strong>{item.label}</strong>{index === 1 && phase === 'inspecting' && <small>长任务进行中</small>}</li>)}
  </ol>

  const workflow = <div className={mode === 'page' ? 'skills-import-page-body' : 'skills-modal-body'}>
    <section className="skills-import-source-panel" aria-labelledby="import-source-title">
      <div className="skills-section-head"><div><div className="skills-eyebrow">Step 1</div><h3 id="import-source-title">选择导入方式</h3><p>不会直接执行 Skill；先读取、解析和扫描，再由 Import Review 决定是否安装。</p></div><span className="skills-status info"><Info size={13} /> source allowlist</span></div>
      <div className="skills-import-tabs" role="tablist" aria-label="Skill 导入方式">
        {IMPORT_SOURCE_TABS.map((item) => <button key={item.kind} type="button" role="tab" aria-selected={sourceKind === item.kind} aria-controls={`import-source-panel-${item.kind}`} className={sourceKind === item.kind ? 'active' : ''} onClick={() => switchSource(item.kind)} disabled={busy}>
          <span className="skills-import-tab-icon">{importSourceIcon(item.kind)}</span><span><strong>{item.label}</strong><small>{item.description}</small></span>
        </button>)}
      </div>
      <div id={`import-source-panel-${sourceKind}`} role="tabpanel" className="skills-import-source-form">
        {sourceKind === 'github' && <>
          <label className="skills-field"><span>Repository URL *</span><input autoFocus value={sourceInput.repositoryUrl || ''} onChange={(event) => updateInput({ repositoryUrl: event.target.value })} placeholder="https://github.com/owner/repository" disabled={busy} /></label>
          <div className="skills-field-grid"><label className="skills-field"><span>Ref / Commit *</span><input value={sourceInput.ref || ''} onChange={(event) => updateInput({ ref: event.target.value })} placeholder="main" disabled={busy} /></label><SubdirectoryField value={sourceInput.subdirectory} onChange={(value) => updateInput({ subdirectory: value })} disabled={busy} /></div>
        </>}
        {sourceKind === 'local-directory' && <>
          <div className="skills-import-directory-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={handleDirectoryDrop}>
            <span className="skills-import-dropzone-icon"><FolderOpen size={18} aria-hidden="true" /></span><strong>拖入 Skill 根目录，或选择本地目录</strong><p>必须包含 SKILL.md；支持 references、assets、scripts 和 templates。</p><button type="button" className="skills-button secondary" onClick={() => void chooseDirectory()} disabled={busy}><FolderOpen size={14} />选择目录</button>
            {sourceInput.directory && <span className="skills-import-selected-path" title={sourceInput.directory}>{sourceInput.directory}</span>}
          </div>
          <label className="skills-field"><span>目录路径</span><input autoFocus={!sourceInput.directory} value={sourceInput.directory || ''} onChange={(event) => updateInput({ directory: event.target.value })} placeholder="D:/skills/my-skill" disabled={busy} /></label>
        </>}
        {sourceKind === 'npx' && <>
          <label className="skills-field"><span>产物目录 *</span><input autoFocus value={sourceInput.artifactPath || ''} onChange={(event) => updateInput({ artifactPath: event.target.value })} placeholder="D:/skills/baoyu-skills/article-illustrator" disabled={busy} /></label>
          <div className="skills-message info"><PackageOpen size={14} />请先在受控环境执行 npx skills add ... --copy，再选择生成的产物目录。后台不会执行 npx，只读取、扫描和安装静态文件。</div>
        </>}
      </div>
      {validationErrors.length > 0 && <div className="skills-message warning"><AlertTriangle size={14} /><span>{validationErrors[0]}</span></div>}
      <div className="skills-import-safety-note"><ShieldCheck size={15} /><div><strong>导入与执行分离</strong><p>导入阶段只读取、扫描和计算内容哈希；任何 web、image、filesystem 或 command 能力都必须在运行时重新授权。</p></div></div>
      <div className="skills-import-actions"><button type="button" className="skills-button primary" onClick={() => void inspect()} disabled={busy || validationErrors.length > 0}><ShieldCheck size={14} />开始扫描</button>{mode === 'page' && <button type="button" className="skills-button secondary" onClick={onClose} disabled={busy}>取消</button>}{error && <div className="skills-message error skills-import-action-error" role="alert"><AlertTriangle size={14} />{error}</div>}</div>
    </section>

    <section className="skills-import-review-panel" aria-labelledby="import-review-title">
      <div className="skills-section-head"><div><div className="skills-eyebrow">Step 2</div><h3 id="import-review-title">解析和扫描</h3><p>Manifest、Capability、诊断和安全发现会与 review 一起保存。</p></div>{activeStatus && <span className={`skills-status ${getImportReviewTone(activeStatus)}`}><ReviewIcon status={activeStatus} />{statusLabel(activeStatus)}</span>}</div>
      {phase === 'inspecting' && <div className="skills-message info" role="status"><LoaderCircle className="spin" size={14} />Runtime 正在读取 source snapshot、解析 manifest 并生成 Import Review…</div>}
      {!inspection && phase !== 'inspecting' && <div className="skills-empty-state"><Info size={16} /><p>提交来源后，这里会显示 manifest、Capability、风险和 review 状态。</p></div>}
      {inspection && <>
        <div className="skills-import-audit-grid"><div><dt>review ID</dt><dd>{inspection.reviewId || '未返回'}</dd></div><div><dt>source fingerprint</dt><dd>{inspection.sourceFingerprint || '未返回'}</dd></div><div><dt>resolved commit</dt><dd>{inspection.resolvedCommitSha || '—'}</dd></div><div><dt>source</dt><dd>{sourceDescription(source)}</dd></div></div>
        {ignoredPaths.length > 0 && <div className="skills-message warning" role="status"><ShieldAlert size={14} /><span>已安全忽略 {ignoredPaths.length} 个不参与 Skill 导入的来源文件：{ignoredPaths.join('、')}</span></div>}
        {packages.map((item) => <InspectionCard key={`${item.manifestHash}-${item.relativeSkillPath}`} item={item} />)}
        {review?.status === 'rejected' && <div className="skills-message error"><ShieldAlert size={14} /><span>Rejected 后不可安装。请修复来源并重新 inspect，不能绕过当前 review。</span></div>}
      </>}
    </section>

    <section className="skills-import-confirm-panel" aria-labelledby="import-confirm-title">
      <div className="skills-section-head"><div><div className="skills-eyebrow">Step 3</div><h3 id="import-confirm-title">确认安装</h3><p>只有 approved review 才能提交一次明确的 `confirm: true` 安装请求。</p></div>{review && <span className={`skills-status ${getImportReviewTone(review.status)}`}><ReviewIcon status={review.status} />{statusLabel(review.status)}</span>}</div>
      {review && review.status !== 'approved' && review.status !== 'installed' && review.status !== 'rejected' && <div className="skills-import-decision-grid"><label className="skills-field"><span>拒绝原因（仅用于 Reject）</span><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="说明风险或缺少的修复" disabled={busy} /></label><div className="skills-button-row"><button type="button" className="skills-button secondary" onClick={() => void approve()} disabled={busy || !review.id}><ShieldCheck size={14} />Approve Review</button><button type="button" className="skills-button danger" onClick={() => void reject()} disabled={busy || !review.id || !reason.trim()}><ShieldAlert size={14} />Reject Review</button></div></div>}
      {review?.status === 'approved' && <div className="skills-message success"><CheckCircle2 size={14} />Review 已批准；安装仍会携带 source fingerprint 和审计上下文。</div>}
      {review?.status === 'rejected' && <div className="skills-message error"><ShieldAlert size={14} />当前 review 已拒绝，安装按钮保持禁用。</div>}
      {phase === 'installing' && <div className="skills-message info" role="status"><LoaderCircle className="spin" size={14} />安装长任务进行中：正在写入 Package、Version 和 Installation 关系…</div>}
      {phase === 'completed' && <div className="skills-message success" role="status"><CheckCircle2 size={14} />安装完成，正在返回 Skills Center 或打开 Package Detail。</div>}
      <div className="skills-import-confirm-actions"><button type="button" className="skills-button primary" onClick={() => void install()} disabled={busy || !canInstall}><CheckCircle2 size={14} />安装已批准的 Skill</button><span className="skills-muted">{canInstall ? '可安装：review 已批准。' : 'Rejected 后不可安装。warning 或未审批的 review 也不能安装。'}</span></div>
    </section>
  </div>

  if (mode === 'page') {
    return <section className="skills-import-page" aria-labelledby="package-import-page-title">
      <div className="skills-import-page-heading"><div className="skills-eyebrow">MANAGE / IMPORT</div><h1 id="package-import-page-title">导入 Skill</h1><p>把本地目录、GitHub Archive 或 npx skills 产物转换为可审核的 Skill Version。</p></div>
      {stepper}
      <div className="skills-import-page-card">{workflow}</div>
    </section>
  }

  return <div className="skills-modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="skills-modal skills-install-modal skills-import-workflow" role="dialog" aria-modal="true" aria-labelledby="package-install-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="skills-modal-head"><div><div className="skills-eyebrow"><PackageOpen size={14} /> Package Import</div><h2 id="package-install-title">导入 Skill</h2><p className="skills-muted">导入、扫描和安装始终分阶段完成，安装请求必须绑定 review 和 source fingerprint。</p></div><button type="button" className="skills-icon-button" onClick={onClose} aria-label="关闭导入窗口" title="关闭导入窗口"><X size={16} /></button></header>
      {stepper}
      {workflow}
      <footer className="skills-modal-foot"><button type="button" className="skills-button secondary" onClick={onClose} disabled={busy}>取消</button><span className="skills-muted">状态、review ID 和 source fingerprint 会保留在审计上下文中。</span></footer>
    </section>
  </div>
}

export type PackageImportWorkbenchProps = Omit<PackageInstallDialogProps, 'onClose' | 'mode'> & { onCancel?: () => void }

export function PackageImportWorkbench({ onCancel, ...props }: PackageImportWorkbenchProps) {
  return <PackageInstallDialog {...props} mode="page" onClose={onCancel ?? (() => undefined)} />
}

function SubdirectoryField({ value, onChange, disabled }: { value?: string; onChange: (value: string) => void; disabled: boolean }) {
  return <label className="skills-field"><span>Skill 子目录（可选）</span><input value={value || ''} onChange={(event) => onChange(event.target.value)} placeholder="skills/article-illustrator" disabled={disabled} /></label>
}

function ReviewIcon({ status }: { status: PackageImportReviewStatus }) {
  if (status === 'approved' || status === 'installed') return <CheckCircle2 size={13} />
  if (status === 'warning' || status === 'pending' || status === 'rejected') return <ShieldAlert size={13} />
  return <Info size={13} />
}

function InspectionCard({ item }: { item: InspectedPackage }) {
  const manifest = item.manifest
  const findings: Array<{ code?: string; severity: string; message: string; path?: string }> = [...item.diagnostics, ...manifest.unsupported.map((message) => ({ severity: 'warning', message }))]
  return <article className="skills-inspection-card">
    <div className="skills-list-row"><div><strong>{manifest.name || '未命名 Skill'}</strong><p>{manifest.description || '未提供描述'}</p></div><span className={`skills-status ${manifest.compatible ? 'success' : 'danger'}`}><ReviewIcon status={manifest.compatible ? 'validated' : 'rejected'} />{manifest.compatible ? 'Runtime compatible' : '不兼容'}</span></div>
    <dl className="skills-compact-kv"><div><dt>来源 ref</dt><dd>{item.sourceSnapshot.sourceCommit || item.sourceSnapshot.sourceRef || '已固定快照'}</dd></div><div><dt>路径</dt><dd>{item.relativeSkillPath || '.'}</dd></div><div><dt>manifest hash</dt><dd>{item.manifestHash || '—'}</dd></div><div><dt>source fingerprint</dt><dd>{item.sourceFingerprint || item.sourceSnapshot.sourceSha256 || '—'}</dd></div></dl>
    <div className="skills-section-label">Capability</div><div className="skills-chip-row">{manifest.requestedCapabilities.map((capability) => <span key={`${capability.capability}-${JSON.stringify(capability.scope)}`} className="skills-chip" title={`scope: ${JSON.stringify(capability.scope)}`}>{capability.capability}<small>{JSON.stringify(capability.scope)}</small></span>)}{manifest.requestedCapabilities.length === 0 && <span className="skills-muted">未声明额外能力</span>}</div>
    {findings.length > 0 ? <div className="skills-import-findings"><strong><AlertTriangle size={13} />风险和诊断 · {findings.length}</strong><ul>{findings.map((finding, index) => <li key={`${finding.code || finding.message}-${index}`}><span className={`skills-status ${finding.severity === 'error' || finding.severity === 'critical' ? 'danger' : finding.severity === 'warning' ? 'warning' : 'info'}`}>{finding.severity}</span>{finding.message}{finding.path ? ` · ${finding.path}` : ''}</li>)}</ul></div> : <div className="skills-message success"><CheckCircle2 size={14} />未发现阻断性诊断；Capability 仍按默认拒绝策略处理。</div>}
    {item.importReviewRequired && <div className="skills-message warning"><ShieldAlert size={14} />此来源需要 Import Review 批准后才能安装。</div>}
  </article>
}
