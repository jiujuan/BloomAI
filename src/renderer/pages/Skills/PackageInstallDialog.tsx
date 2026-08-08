import React, { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileArchive, FolderOpen, Github, Info, LoaderCircle, PackageOpen, ShieldAlert, ShieldCheck, X } from 'lucide-react'
import { useSkillRuntimeStore } from './skill-runtime.store'
import type { InspectedPackage, PackageImportReview, PackageImportReviewStatus, PackageInspectionResult, PackageInstallInput, PackageSource } from './skill-runtime.types'

export type ImportSourceKind = 'github' | 'local-directory' | 'zip' | 'npx'

export type PackageSourceInput = {
  repositoryUrl?: string
  ref?: string
  subdirectory?: string
  directory?: string
  artifactPath?: string
  packageName?: string
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
    const parts = url.pathname.split('/').filter(Boolean)
    return (url.protocol === 'https:' || url.protocol === 'http:') && (url.hostname === 'github.com' || url.hostname === 'www.github.com') && parts.length >= 2
  } catch {
    return false
  }
}

function isNpxPackageName(value: string) {
  return /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(value)
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
  if (kind === 'npx') {
    if (!isNpxPackageName(trim(input.packageName))) errors.push('请输入有效的 npx 包名。')
    if (!trim(input.artifactPath)) errors.push('请输入已生成的 npx 产物路径。')
  }
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

export function PackageInstallDialog({ onClose, onOpenCreator, onInstalled, initialInspection, initialReview, reviewer = 'local-user' }: {
  onClose: () => void
  onOpenCreator?: (item: InspectedPackage) => void
  onInstalled?: (context: PackageImportAuditContext) => void
  initialInspection?: PackageInspectionResult
  initialReview?: PackageImportReview
  reviewer?: string
}) {
  const { inspectPackage, getImportReview, approveImportReview, rejectImportReview, installPackage } = useSkillRuntimeStore()
  const [sourceKind, setSourceKind] = useState<ImportSourceKind>('github')
  const [sourceInput, setSourceInput] = useState<PackageSourceInput>({ ref: 'main' })
  const [source, setSource] = useState<PackageSource | null>(null)
  const [inspection, setInspection] = useState<PackageInspectionResult | null>(initialInspection ?? null)
  const [review, setReview] = useState<PackageImportReview | null>(initialReview ?? null)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [phase, setPhase] = useState<ImportPhase>(initialInspection ? 'review' : 'choose')

  const packages = inspection?.packages ?? []
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
      setReview(await approveImportReview(review.id, reviewer))
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
      setReview(await rejectImportReview(review.id, reviewer, decisionReason))
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
      onClose()
    } catch (cause) {
      setPhase('review')
      setError(cause instanceof Error ? cause.message : '安装 Package 失败。')
    }
  }

  const activeStatus = review?.status || (inspection ? 'validated' : undefined)
  return (
    <div className="skills-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="skills-modal skills-install-modal skills-import-workflow" role="dialog" aria-modal="true" aria-labelledby="package-install-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="skills-modal-head">
          <div><div className="skills-eyebrow"><PackageOpen size={14} /> Package Import</div><h2 id="package-install-title">导入 Skill</h2><p className="skills-muted">导入、扫描和安装始终分阶段完成，安装请求必须绑定 review 和 source fingerprint。</p></div>
          <button type="button" className="skills-icon-button" onClick={onClose} aria-label="关闭导入窗口" title="关闭导入窗口"><X size={16} /></button>
        </header>
        <ol className="skills-import-stepper" aria-label="Skill 导入流程">
          {PHASES.map((item, index) => <li key={item.id} className={index < currentStep ? 'complete' : index === currentStep ? 'active' : 'pending'}><span aria-hidden="true">{index < currentStep ? '✓' : index + 1}</span><strong>{item.label}</strong>{index === 1 && phase === 'inspecting' && <small>长任务进行中</small>}</li>)}
        </ol>
        <div className="skills-modal-body">
          <section className="skills-import-source-panel" aria-labelledby="import-source-title">
            <div className="skills-section-head"><div><div className="skills-eyebrow">Step 1</div><h3 id="import-source-title">选择来源</h3><p>支持 GitHub、本地目录、ZIP 和已生成的 npx 产物；Renderer 不会直接执行任意 npx 命令。</p></div><span className="skills-status info"><Info size={13} /> source allowlist</span></div>
            <label className="skills-field"><span>来源类型</span><select aria-label="导入来源类型" value={sourceKind} onChange={(event) => { setSourceKind(event.target.value as ImportSourceKind); updateInput({}) }} disabled={busy}><option value="github">GitHub</option><option value="local-directory">本地目录</option><option value="zip">ZIP</option><option value="npx">npx 产物</option></select></label>
            {sourceKind === 'github' && <><label className="skills-field"><span>GitHub 仓库 URL</span><input autoFocus value={sourceInput.repositoryUrl || ''} onChange={(event) => updateInput({ repositoryUrl: event.target.value })} placeholder="https://github.com/owner/repository" disabled={busy} /></label><div className="skills-field-grid"><label className="skills-field"><span>Commit、tag 或 branch</span><input value={sourceInput.ref || ''} onChange={(event) => updateInput({ ref: event.target.value })} placeholder="main" disabled={busy} /></label><SubdirectoryField value={sourceInput.subdirectory} onChange={(value) => updateInput({ subdirectory: value })} disabled={busy} /></div></>}
            {sourceKind === 'local-directory' && <><label className="skills-field"><span>本地目录路径</span><input autoFocus value={sourceInput.directory || ''} onChange={(event) => updateInput({ directory: event.target.value })} placeholder="C:\\skills\\my-skill" disabled={busy} /></label><SubdirectoryField value={sourceInput.subdirectory} onChange={(value) => updateInput({ subdirectory: value })} disabled={busy} /></>}
            {sourceKind === 'zip' && <><label className="skills-field"><span>ZIP 产物路径</span><input autoFocus value={sourceInput.artifactPath || ''} onChange={(event) => updateInput({ artifactPath: event.target.value })} placeholder="C:\\artifacts\\skill.zip" disabled={busy} /></label><SubdirectoryField value={sourceInput.subdirectory} onChange={(value) => updateInput({ subdirectory: value })} disabled={busy} /></>}
            {sourceKind === 'npx' && <><div className="skills-field-grid"><label className="skills-field"><span>npx 包名</span><input autoFocus value={sourceInput.packageName || ''} onChange={(event) => updateInput({ packageName: event.target.value })} placeholder="@scope/skill-package" disabled={busy} /></label><label className="skills-field"><span>已生成产物路径</span><input value={sourceInput.artifactPath || ''} onChange={(event) => updateInput({ artifactPath: event.target.value })} placeholder="C:\\artifacts\\skill.zip 或目录" disabled={busy} /></label></div><div className="skills-message info"><PackageOpen size={14} />npx 仅作为来源审计标签；请先在受控环境生成目录或 ZIP，再交给 Runtime inspect。</div></>}
            {validationErrors.length > 0 && <div className="skills-message warning"><AlertTriangle size={14} /><span>{validationErrors[0]}</span></div>}
            <button type="button" className="skills-button primary" onClick={() => void inspect()} disabled={busy || validationErrors.length > 0}><ShieldCheck size={14} />检查并扫描来源</button>
          </section>

          <section className="skills-import-review-panel" aria-labelledby="import-review-title">
            <div className="skills-section-head"><div><div className="skills-eyebrow">Step 2</div><h3 id="import-review-title">解析和扫描</h3><p>Manifest、Capability、诊断和安全发现会与 review 一起保存。</p></div>{activeStatus && <span className={`skills-status ${getImportReviewTone(activeStatus)}`}><ReviewIcon status={activeStatus} />{statusLabel(activeStatus)}</span>}</div>
            {phase === 'inspecting' && <div className="skills-message info" role="status"><LoaderCircle className="spin" size={14} />Runtime 正在读取 source snapshot、解析 manifest 并生成 Import Review…</div>}
            {!inspection && phase !== 'inspecting' && <div className="skills-empty-state"><Info size={16} /><p>提交来源后，这里会显示 manifest、Capability、风险和 review 状态。</p></div>}
            {inspection && <>
              <div className="skills-import-audit-grid"><div><dt>review ID</dt><dd>{inspection.reviewId || '未返回'}</dd></div><div><dt>source fingerprint</dt><dd>{inspection.sourceFingerprint || '未返回'}</dd></div><div><dt>resolved commit</dt><dd>{inspection.resolvedCommitSha || '—'}</dd></div><div><dt>source</dt><dd>{sourceDescription(source)}</dd></div></div>
              {packages.map((item) => <InspectionCard key={`${item.manifestHash}-${item.relativeSkillPath}`} item={item} onOpenCreator={onOpenCreator} />)}
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
          {error && <div className="skills-message error" role="alert"><AlertTriangle size={14} />{error}</div>}
        </div>
        <footer className="skills-modal-foot"><button type="button" className="skills-button secondary" onClick={onClose} disabled={busy}>取消</button><span className="skills-muted">状态、review ID 和 source fingerprint 会保留在审计上下文中。</span></footer>
      </section>
    </div>
  )
}

function SubdirectoryField({ value, onChange, disabled }: { value?: string; onChange: (value: string) => void; disabled: boolean }) {
  return <label className="skills-field"><span>Skill 子目录（可选）</span><input value={value || ''} onChange={(event) => onChange(event.target.value)} placeholder="skills/article-illustrator" disabled={disabled} /></label>
}

function ReviewIcon({ status }: { status: PackageImportReviewStatus }) {
  if (status === 'approved' || status === 'installed') return <CheckCircle2 size={13} />
  if (status === 'warning' || status === 'pending' || status === 'rejected') return <ShieldAlert size={13} />
  return <Info size={13} />
}

function InspectionCard({ item, onOpenCreator }: { item: InspectedPackage; onOpenCreator?: (item: InspectedPackage) => void }) {
  const manifest = item.manifest
  const findings: Array<{ code?: string; severity: string; message: string; path?: string }> = [...item.diagnostics, ...manifest.unsupported.map((message) => ({ severity: 'warning', message }))]
  return <article className="skills-inspection-card">
    <div className="skills-list-row"><div><strong>{manifest.name || '未命名 Skill'}</strong><p>{manifest.description || '未提供描述'}</p></div><span className={`skills-status ${manifest.compatible ? 'success' : 'danger'}`}><ReviewIcon status={manifest.compatible ? 'validated' : 'rejected'} />{manifest.compatible ? 'Runtime compatible' : '不兼容'}</span></div>
    <dl className="skills-compact-kv"><div><dt>来源 ref</dt><dd>{item.sourceSnapshot.sourceCommit || item.sourceSnapshot.sourceRef || '已固定快照'}</dd></div><div><dt>路径</dt><dd>{item.relativeSkillPath || '.'}</dd></div><div><dt>manifest hash</dt><dd>{item.manifestHash || '—'}</dd></div><div><dt>source fingerprint</dt><dd>{item.sourceFingerprint || item.sourceSnapshot.sourceSha256 || '—'}</dd></div></dl>
    <div className="skills-section-label">Capability</div><div className="skills-chip-row">{manifest.requestedCapabilities.map((capability) => <span key={`${capability.capability}-${JSON.stringify(capability.scope)}`} className="skills-chip" title={`scope: ${JSON.stringify(capability.scope)}`}>{capability.capability}<small>{JSON.stringify(capability.scope)}</small></span>)}{manifest.requestedCapabilities.length === 0 && <span className="skills-muted">未声明额外能力</span>}</div>
    {findings.length > 0 ? <div className="skills-import-findings"><strong><AlertTriangle size={13} />风险和诊断 · {findings.length}</strong><ul>{findings.map((finding, index) => <li key={`${finding.code || finding.message}-${index}`}><span className={`skills-status ${finding.severity === 'error' || finding.severity === 'critical' ? 'danger' : finding.severity === 'warning' ? 'warning' : 'info'}`}>{finding.severity}</span>{finding.message}{finding.path ? ` · ${finding.path}` : ''}</li>)}</ul></div> : <div className="skills-message success"><CheckCircle2 size={14} />未发现阻断性诊断；Capability 仍按默认拒绝策略处理。</div>}
    {item.importReviewRequired && <div className="skills-message warning"><ShieldAlert size={14} />此来源需要 Import Review 批准后才能安装。</div>}
    {onOpenCreator && <button type="button" className="skills-text-button" onClick={() => onOpenCreator(item)}>在 Creator 中编辑此检查结果</button>}
  </article>
}
