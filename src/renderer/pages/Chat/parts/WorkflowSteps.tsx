import React from 'react'
import { Check, Loader2, X, ListTree } from 'lucide-react'
import { cn } from '@renderer/utils'

type StepStatus = 'running' | 'success' | 'error' | string

type WorkflowStep = {
  name?: string
  status?: StepStatus
  input?: Record<string, unknown>
  output?: any
}

type WorkflowData = {
  name?: string
  status?: StepStatus
  steps?: Record<string, WorkflowStep>
}

// Friendly labels for known deep-research steps; falls back to a humanized id.
const STEP_LABELS: Record<string, string> = {
  'plan-questions': '拆解子问题',
  'search-web': '并行检索',
  'fetch-content': '抓取正文',
  'gather-sources': '检索资料',
  'research-writer': '撰写报告',
}

const WORKFLOW_LABELS: Record<string, string> = {
  'deep-research': '深度研究',
}

function stepLabel(id: string, step: WorkflowStep): string {
  if (STEP_LABELS[id]) return STEP_LABELS[id]
  const name = step.name || id
  if (/writer|report/i.test(name)) return '撰写报告'
  if (/fetch/i.test(name)) return '抓取正文'
  if (/search|source|gather/i.test(name)) return '检索资料'
  if (/plan|question/i.test(name)) return '拆解子问题'
  return humanize(name)
}

function humanize(id: string): string {
  return id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// Mastra inserts internal mapping steps between user steps; hide them from the timeline.
function isInternalStep(id: string, step: WorkflowStep): boolean {
  return /^mapping[-_]|^map[-_]|^\.?map\b/i.test(id) || /^mapping/i.test(step.name || '')
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  running: <Loader2 size={11} className="spin" />,
  success: <Check size={11} />,
  error: <X size={11} />,
}

function stepStatusIcon(status?: StepStatus): React.ReactNode {
  return STATUS_ICON[status || ''] ?? <Loader2 size={11} className="spin" />
}

/** Renders a deep-research workflow's step progress (from a `data-workflow` part). */
export function WorkflowSteps({ data }: { data: WorkflowData }) {
  const entries = Object.entries(data.steps || {}).filter(([id, step]) => !isInternalStep(id, step))
  if (entries.length === 0) return null

  const overall: StepStatus = data.status || 'running'
  const title = WORKFLOW_LABELS[data.name || ''] || humanize(data.name || 'workflow')

  return (
    <div className={cn('workflow-card', overall)} data-workflow-status={overall}>
      <div className="workflow-head">
        <span className="workflow-icon"><ListTree size={12} /></span>
        <span className="workflow-name">{title}</span>
        <span className={cn('workflow-status', overall)}>{stepStatusIcon(overall)}</span>
      </div>
      <ol className="workflow-steps">
        {entries.map(([id, step]) => {
          const meta = stepMeta(id, step)
          return (
            <li key={id} className={cn('workflow-step', step.status)}>
              <span className={cn('workflow-step-icon', step.status)}>{stepStatusIcon(step.status)}</span>
              <span className="workflow-step-label">{stepLabel(id, step)}</span>
              {step.status === 'success' && meta && <span className="workflow-step-meta">{meta}</span>}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function stepMeta(id: string, step: WorkflowStep): string | null {
  const output: any = step.output
  if ((id === 'plan-questions' || /plan|question/i.test(step.name || '')) && Array.isArray(output?.subQuestions)) {
    return `${output.subQuestions.length} 个子问题`
  }
  const count = sourceCount(output)
  if (count != null) return `${count} 来源`
  return null
}

function sourceCount(output: any): number | null {
  if (output && typeof output.sources === 'string') {
    const matches = output.sources.match(/^\[\d+\]/gm)
    return matches ? matches.length : null
  }
  return null
}
