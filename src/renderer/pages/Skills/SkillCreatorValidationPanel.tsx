import React from 'react'
import type { DraftValidation, DraftValidationIssue } from './skill-runtime.types'

function issueLocation(issue: DraftValidationIssue) {
  const target = issue.file || issue.path || 'draft'
  const line = issue.line ? ` · line ${issue.line}${issue.column ? `:${issue.column}` : ''}` : ''
  return `${target}${line}`
}

function IssueList({ issues, tone }: { issues: DraftValidationIssue[]; tone: 'error' | 'warning' }) {
  if (issues.length === 0) return <p className="skills-muted">无{tone === 'error' ? '错误' : '警告'}。</p>
  return <ul className={`skills-creator-issues ${tone}`}>{issues.map((issue, index) => <li key={`${issue.code || issue.message}-${index}`}><strong>{issueLocation(issue)}</strong><span>{issue.message}</span></li>)}</ul>
}

export function SkillCreatorValidationPanel({ validation }: { validation: DraftValidation | null }) {
  return <section className="skills-creator-validation" aria-labelledby="creator-validation-title">
    <div className="skills-section-head"><div><div className="skills-eyebrow">Server contract</div><h3 id="creator-validation-title">Validation</h3><p>错误和警告保留 field/file/line 定位，发布前必须有有效验证证据。</p></div><span className={'skills-status ' + (validation?.valid ? 'success' : validation ? 'danger' : 'muted')}>{validation ? (validation.valid ? 'valid' : 'invalid') : 'not run'}</span></div>
    {!validation ? <p className="skills-muted">尚未执行 Validate。</p> : <div className="skills-creator-validation-columns"><div><strong>Errors · {validation.errors.length}</strong><IssueList issues={validation.errors} tone="error" /></div><div><strong>Warnings · {validation.warnings.length}</strong><IssueList issues={validation.warnings} tone="warning" /></div></div>}
  </section>
}
