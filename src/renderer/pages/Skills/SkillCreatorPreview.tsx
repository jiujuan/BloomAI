import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { DraftPreview, SkillDraftContent } from './skill-runtime.types'

export function sanitizeMarkdown(markdown: string) {
  return markdown.replace(/<[^>]*>/g, '')
}

type SkillCreatorPreviewProps = {
  content: SkillDraftContent
  preview: DraftPreview | null
}

export function SkillCreatorPreview({ content, preview }: SkillCreatorPreviewProps) {
  const safeMarkdown = sanitizeMarkdown(content.skillMd || '')
  const risks = preview?.capabilityRisks ?? []
  return <section className="skills-creator-preview" aria-labelledby="creator-preview-title">
    <div className="skills-section-head"><div><div className="skills-eyebrow">Evidence</div><h3 id="creator-preview-title">Preview</h3><p>预览只渲染脱敏后的 Markdown，不执行 HTML、脚本或事件属性。</p></div></div>
    <article className="skills-markdown-preview"><h4>{content.name || 'Untitled Skill'}</h4><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{safeMarkdown}</ReactMarkdown></article>
    <div className="skills-creator-evidence"><strong>预计 Artifact / Version</strong>{preview?.immutableVersion ? <p>v{preview.immutableVersion.version} · source hash {preview.immutableVersion.sourceHash}</p> : <p>完成 Validate 和 Preview 后显示 immutable version 与 source hash。</p>}</div>
    <div className="skills-creator-evidence"><strong>Capability 风险</strong>{risks.length === 0 ? <p>当前没有待审批的 capability risk。</p> : <ul>{risks.map((risk) => <li key={`${risk.capability}-${risk.severity}`}><span className={'skills-status ' + (risk.severity === 'high' ? 'danger' : risk.severity === 'medium' ? 'warning' : 'info')}>{risk.severity}</span> {risk.capability} · {JSON.stringify(risk.scope)}</li>)}</ul>}</div>
  </section>
}
