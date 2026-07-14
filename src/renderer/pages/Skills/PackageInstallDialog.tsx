import React, { useState } from 'react'
import { AlertTriangle, CheckCircle2, Github, LoaderCircle, X } from 'lucide-react'
import { useSkillRuntimeStore } from './skill-runtime.store'
import type { InspectedPackage, PackageSource } from './skill-runtime.types'

export function PackageInstallDialog({ onClose }: { onClose: () => void }) {
  const { inspectPackage, installPackage } = useSkillRuntimeStore()
  const [repositoryUrl, setRepositoryUrl] = useState('')
  const [ref, setRef] = useState('main')
  const [subdirectory, setSubdirectory] = useState('')
  const [packages, setPackages] = useState<InspectedPackage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const source = (): PackageSource => ({
    kind: 'github-archive',
    repositoryUrl: repositoryUrl.trim(),
    ref: ref.trim() || 'main',
    ...(subdirectory.trim() ? { subdirectory: subdirectory.trim() } : {}),
  })

  const inspect = async () => {
    setError(null)
    if (!repositoryUrl.trim()) { setError('请输入 GitHub 仓库 URL。'); return }
    setBusy(true)
    try { setPackages(await inspectPackage(source())) } catch (cause) { setError(cause instanceof Error ? cause.message : '检查 Package 失败。') } finally { setBusy(false) }
  }

  const install = async () => {
    setError(null)
    setBusy(true)
    try { await installPackage(source()); onClose() } catch (cause) { setError(cause instanceof Error ? cause.message : '安装 Package 失败。') } finally { setBusy(false) }
  }

  return (
    <div className="skills-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="skills-modal skills-install-modal" role="dialog" aria-modal="true" aria-labelledby="package-install-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="skills-modal-head">
          <div><div className="skills-eyebrow"><Github size={14} /> Package 安装</div><h2 id="package-install-title">从 GitHub 安装固定版本</h2></div>
          <button className="skills-icon-button" onClick={onClose} aria-label="关闭安装窗口"><X size={16} /></button>
        </header>
        <div className="skills-modal-body">
          <p className="skills-muted">先检查 manifest、声明权限和 B-Lite 兼容性；确认后才会将该 ref 安装到本地。</p>
          <label className="skills-field"><span>GitHub 仓库 URL</span><input autoFocus value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)} placeholder="https://github.com/owner/repository" /></label>
          <div className="skills-field-grid">
            <label className="skills-field"><span>Commit、tag 或 branch</span><input value={ref} onChange={(event) => setRef(event.target.value)} placeholder="main" /></label>
            <label className="skills-field"><span>Skill 子目录（可选）</span><input value={subdirectory} onChange={(event) => setSubdirectory(event.target.value)} placeholder="skills/article-illustrator" /></label>
          </div>
          {error && <div className="skills-message error"><AlertTriangle size={15} />{error}</div>}
          {packages.length > 0 && <div className="skills-inspection-list">
            <div className="skills-section-label">检查结果 · {packages.length} 个 Skill</div>
            {packages.map((item) => <InspectionCard key={item.manifestHash + item.relativeSkillPath} item={item} />)}
          </div>}
        </div>
        <footer className="skills-modal-foot">
          <button className="skills-button secondary" onClick={onClose}>取消</button>
          <button className="skills-button secondary" onClick={inspect} disabled={busy}>{busy ? <LoaderCircle className="spin" size={14} /> : null}检查 Package</button>
          <button className="skills-button primary" onClick={install} disabled={busy || packages.length === 0}>{busy ? <LoaderCircle className="spin" size={14} /> : <CheckCircle2 size={14} />}安装此固定版本</button>
        </footer>
      </section>
    </div>
  )
}

function InspectionCard({ item }: { item: InspectedPackage }) {
  const manifest = item.manifest
  return <article className="skills-inspection-card">
    <div className="skills-list-row"><div><strong>{manifest.name}</strong><p>{manifest.description || '未提供描述'}</p></div><span className={'skills-status ' + (manifest.compatible ? 'success' : 'danger')}>{manifest.compatible ? 'B-Lite compatible' : '需要后续运行时'}</span></div>
    <dl className="skills-compact-kv"><div><dt>来源 ref</dt><dd>{item.sourceSnapshot.sourceCommit || item.sourceSnapshot.sourceRef || '已固定快照'}</dd></div><div><dt>路径</dt><dd>{item.relativeSkillPath || '.'}</dd></div></dl>
    <div className="skills-chip-row">{manifest.requestedCapabilities.map((capability) => <span key={capability.capability} className="skills-chip">{capability.capability}</span>)}{manifest.requestedCapabilities.length === 0 && <span className="skills-muted">未声明额外能力</span>}</div>
    {manifest.unsupported.length > 0 && <div className="skills-message warning"><AlertTriangle size={14} />不兼容：{manifest.unsupported.join('、')}</div>}
  </article>
}
