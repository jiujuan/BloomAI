import React from 'react'

export interface ResearchRunPartData {
  runId: string
  title: string
  status: string
  artifactId: string | null
}

const STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  planning: '规划中',
  researching: '研究中',
  writing: '撰写中',
  verifying: '核验中',
  awaiting_input: '需要澄清',
  completed: '已完成',
  completed_with_limitations: '已完成（有限制）',
  cancelled: '已取消',
  failed: '失败',
  interrupted: '已中断',
}

export function ResearchRunPart({ data, onOpen }: { data: ResearchRunPartData; onOpen: (runId: string) => void }) {
  return <button
    type="button"
    className="research-run-part"
    onClick={() => onOpen(data.runId)}
    data-run-id={data.runId}
    data-artifact-id={data.artifactId || undefined}
    aria-label={`打开深度研究：${data.title}`}
  >
    <span className="research-run-part-title">{data.title}</span>
    <span className="research-run-part-status">{STATUS_LABELS[data.status] || data.status}</span>
    <span className="research-run-part-id">{data.runId}</span>
  </button>
}
