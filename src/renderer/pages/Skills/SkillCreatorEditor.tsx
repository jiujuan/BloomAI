import React, { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { RequestedCapability, SkillDraftContent } from './skill-runtime.types'

const MAX_ASSET_BYTES = 10 * 1024 * 1024
const EXECUTABLE_EXTENSIONS = /\.(?:exe|dll|com|bat|cmd|sh|ps1|msi|app|dmg|pkg)$/i

type SkillCreatorEditorProps = {
  content: SkillDraftContent
  onChange: (content: SkillDraftContent) => void
  disabled?: boolean
}

export function SkillCreatorEditor({ content, onChange, disabled = false }: SkillCreatorEditorProps) {
  const [assetPath, setAssetPath] = useState('')
  const [assetSize, setAssetSize] = useState('')
  const [assetError, setAssetError] = useState<string | null>(null)
  const [capability, setCapability] = useState('')
  const [capabilityScope, setCapabilityScope] = useState('{}')
  const assets = content.assets ?? []
  const capabilities = content.capabilities ?? []

  const update = <K extends keyof SkillDraftContent>(key: K, value: SkillDraftContent[K]) => onChange({ ...content, [key]: value })

  const addAsset = () => {
    const path = assetPath.trim().replaceAll('\\', '/')
    const sizeBytes = assetSize.trim() ? Number(assetSize) : undefined
    if (!path || path.startsWith('/') || path.includes('../') || path.includes('..\\') || EXECUTABLE_EXTENSIONS.test(path)) {
      setAssetError('只允许受限的相对文件资产，禁止绝对路径和可执行文件。')
      return
    }
    if (sizeBytes !== undefined && (!Number.isFinite(sizeBytes) || sizeBytes < 0 || sizeBytes > MAX_ASSET_BYTES)) {
      setAssetError('文件资产大小必须在 10 MiB 以内。')
      return
    }
    setAssetError(null)
    update('assets', [...assets, { path, ...(sizeBytes === undefined ? {} : { sizeBytes }) }])
    setAssetPath('')
    setAssetSize('')
  }

  const addCapability = () => {
    const name = capability.trim()
    if (!name) return
    let scope: RequestedCapability['scope'] = {}
    try {
      const parsed = JSON.parse(capabilityScope)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('scope must be an object')
      scope = parsed
    } catch {
      return
    }
    update('capabilities', [...capabilities, { capability: name, scope }])
    setCapability('')
    setCapabilityScope('{}')
  }

  return <section className="skills-creator-editor" aria-label="Skill draft editor">
    <div className="skills-field-grid">
      <label className="skills-field"><span>名称</span><input aria-label="Skill name" value={content.name} disabled={disabled} onChange={(event) => update('name', event.target.value)} /></label>
      <label className="skills-field"><span>Slug</span><input aria-label="Skill slug" value={content.slug} disabled={disabled} onChange={(event) => update('slug', event.target.value)} /></label>
    </div>
    <div className="skills-field-grid">
      <label className="skills-field"><span>版本</span><input aria-label="Skill version" value={content.version || ''} disabled={disabled} onChange={(event) => update('version', event.target.value)} /></label>
      <label className="skills-field"><span>可见性</span><select value={content.visibility || 'private'} disabled={disabled} onChange={(event) => update('visibility', event.target.value as SkillDraftContent['visibility'])}><option value="private">Private</option><option value="workspace">Workspace</option><option value="public">Public</option></select></label>
    </div>
    <label className="skills-field"><span>描述</span><input aria-label="Skill description" value={content.description || ''} disabled={disabled} onChange={(event) => update('description', event.target.value)} /></label>
    <label className="skills-field"><span>SKILL.md</span><textarea aria-label="SKILL.md" className="skills-code-input" rows={16} spellCheck={false} value={content.skillMd} disabled={disabled} onChange={(event) => update('skillMd', event.target.value)} /></label>

    <section className="skills-creator-subsection" aria-labelledby="creator-assets-title">
      <div className="skills-section-label" id="creator-assets-title">受限文件资产</div>
      <p className="skills-muted">只记录经过校验的相对路径和大小；Creator 不接受任意本地绝对路径或可执行文件上传。</p>
      <div className="skills-field-grid">
        <label className="skills-field"><span>相对路径</span><input value={assetPath} disabled={disabled} onChange={(event) => setAssetPath(event.target.value)} placeholder="references/example.md" /></label>
        <label className="skills-field"><span>大小（bytes，可选）</span><input inputMode="numeric" value={assetSize} disabled={disabled} onChange={(event) => setAssetSize(event.target.value)} placeholder="1048576" /></label>
      </div>
      {assetError && <div className="skills-message error">{assetError}</div>}
      <button type="button" className="skills-button secondary" disabled={disabled} onClick={addAsset}><Plus size={14} />添加受限资产</button>
      {assets.length > 0 && <ul className="skills-creator-list">{assets.map((asset, index) => <li key={`${asset.path}-${index}`}><span>{asset.path} · {asset.sizeBytes ?? 'size pending'} bytes</span><button type="button" className="skills-icon-button" aria-label={`移除资产 ${asset.path}`} disabled={disabled} onClick={() => update('assets', assets.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></button></li>)}</ul>}
    </section>

    <section className="skills-creator-subsection" aria-labelledby="creator-capabilities-title">
      <div className="skills-section-label" id="creator-capabilities-title">Capability 请求</div>
      <div className="skills-field-grid">
        <label className="skills-field"><span>Capability</span><input value={capability} disabled={disabled} onChange={(event) => setCapability(event.target.value)} placeholder="web_search" /></label>
        <label className="skills-field"><span>Scope JSON</span><input value={capabilityScope} disabled={disabled} onChange={(event) => setCapabilityScope(event.target.value)} placeholder='{"allowedDomains":["example.com"]}' /></label>
      </div>
      <button type="button" className="skills-button secondary" disabled={disabled} onClick={addCapability}><Plus size={14} />添加 Capability 请求</button>
      {capabilities.length > 0 && <ul className="skills-creator-list">{capabilities.map((item, index) => <li key={`${item.capability}-${index}`}><span>{item.capability} · {JSON.stringify(item.scope)}</span><button type="button" className="skills-icon-button" aria-label={`移除 capability ${item.capability}`} disabled={disabled} onClick={() => update('capabilities', capabilities.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></button></li>)}</ul>}
    </section>
  </section>
}
