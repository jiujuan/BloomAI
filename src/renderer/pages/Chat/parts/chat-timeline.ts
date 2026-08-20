import { isToolPart, toToolCallView, toolStatus, type ToolCallView, type ToolStatus } from './tool-part'

export type ChatActivityKind =
  | 'reasoning'
  | 'tool'
  | 'workflow'
  | 'plan'
  | 'skill'
  | 'approval'
  | 'error'
  | 'research'

export type ChatActivityStatus = 'running' | 'success' | 'error' | 'permission' | 'neutral'

export type ChatActivity = {
  id: string
  kind: ChatActivityKind
  label: string
  status: ChatActivityStatus
  critical: boolean
  expandable: boolean
  parts: any[]
  /** True when the activity belongs to the current stream or is still receiving data. */
  streaming?: boolean
  /** Tool name is kept for detail renderers and stable labels. */
  toolName?: string
}

export type AssistantTurnModel = {
  activities: ChatActivity[]
  answerParts: any[]
}

export type TimelineBuildOptions = {
  streaming?: boolean
}

const TOOL_STATUS_PRIORITY: ToolStatus[] = ['running', 'error', 'permission', 'success']

export function activityLabelForTool(name: string): string {
  const normalized = String(name || '').toLowerCase()
  if (normalized.includes('search') || normalized.includes('web')) return '搜索资料'
  if (normalized.includes('fs') || normalized.includes('file') || normalized.includes('doc')) return '读取文件'
  if (normalized.includes('shell') || normalized.includes('bash') || normalized.includes('runner')) return '运行命令'
  if (normalized.includes('image')) return '生成图片'
  if (normalized.includes('video')) return '处理视频'
  return '工具调用'
}

export function activityStatusLabel(status: ChatActivityStatus): string {
  switch (status) {
    case 'running':
      return '运行中'
    case 'success':
      return ''
    case 'error':
      return '失败'
    case 'permission':
      return '等待确认'
    default:
      return ''
  }
}

/** Only live/blocked states remain visible as compact rows when the summary is collapsed. */
export function shouldShowWhenSummaryCollapsed(activity: Pick<ChatActivity, 'status' | 'critical'>): boolean {
  return activity.critical && activity.status !== 'error'
}

export function defaultActivityOpen(
  activity: Pick<ChatActivity, 'status' | 'critical'>,
  context: { streaming: boolean; historical: boolean },
): boolean {
  if (activity.critical || activity.status === 'running' || activity.status === 'permission' || activity.status === 'error') {
    return true
  }
  if (context.streaming && !context.historical) return true
  return false
}

export function buildAssistantTurnModel(parts: any[], options: TimelineBuildOptions = {}): AssistantTurnModel {
  const activities: ChatActivity[] = []
  const answerParts: any[] = []
  const source = Array.isArray(parts) ? parts : []
  const streaming = options.streaming === true

  let i = 0
  while (i < source.length) {
    const part = source[i]
    if (!part || typeof part.type !== 'string') {
      i += 1
      continue
    }

    if (part.type === 'text') {
      if (typeof part.text === 'string' || part.text == null) {
        answerParts.push({ ...part, text: part.text || '' })
      }
      i += 1
      continue
    }

    if (isToolPart(part)) {
      const firstCall = toToolCallView(part)
      const groupedParts: any[] = [part]
      const calls: ToolCallView[] = [firstCall]
      let j = i + 1
      while (j < source.length && isToolPart(source[j])) {
        const nextCall = toToolCallView(source[j])
        if (nextCall.name !== firstCall.name) break
        groupedParts.push(source[j])
        calls.push(nextCall)
        j += 1
      }

      const status = aggregateToolStatus(calls)
      const activityStreaming = streaming || calls.some((call) => call.state === 'input-streaming' || call.state === 'input-available') && status === 'running'
      activities.push({
        id: `activity-${i}`,
        kind: 'tool',
        label: activityLabelForTool(firstCall.name),
        status,
        critical: status === 'running' || status === 'error' || status === 'permission',
        expandable: calls.length > 0,
        parts: groupedParts,
        streaming: activityStreaming,
        toolName: firstCall.name,
      })
      i = j
      continue
    }

    const activity = activityFromPart(part, i, streaming)
    if (activity) activities.push(activity)
    i += 1
  }

  return { activities, answerParts }
}

function aggregateToolStatus(calls: ToolCallView[]): ChatActivityStatus {
  const statuses = calls.map(toolStatus)
  for (const status of TOOL_STATUS_PRIORITY) {
    if (statuses.includes(status)) return status
  }
  return 'success'
}

function activityFromPart(part: any, index: number, streamActive: boolean): ChatActivity | null {
  switch (part.type) {
    case 'reasoning': {
      const text = typeof part.text === 'string' ? part.text : ''
      const active = part.state === 'streaming' || streamActive
      if (!text.trim() && !active) return null
      return {
        id: `activity-${index}`,
        kind: 'reasoning',
        label: '思考过程',
        status: active ? 'running' : 'success',
        critical: active,
        expandable: Boolean(text.trim()),
        parts: [part],
        streaming: active,
      }
    }
    case 'data-workflow': {
      if (!part.data) return null
      const status = normalizeStatus(part.data.status)
      const hasDetails = Object.keys(part.data.steps || {}).length > 0
      return {
        id: `activity-${index}`,
        kind: 'workflow',
        label: workflowLabel(part.data.name),
        status,
        critical: status === 'running' || status === 'error',
        expandable: hasDetails,
        parts: [part],
        streaming: streamActive || status === 'running',
      }
    }
    case 'data-plan': {
      if (!part.data) return null
      const tasks = Array.isArray(part.data.tasks) ? part.data.tasks : []
      if (!tasks.length) return null
      const status = planStatus(part.data.status)
      return {
        id: `activity-${index}`,
        kind: 'plan',
        label: '计划任务',
        status,
        critical: status === 'running' || status === 'error' || status === 'permission',
        expandable: true,
        parts: [part],
        streaming: streamActive || status === 'running',
      }
    }
    case 'data-skill-run': {
      if (!part.data) return null
      const status = skillStatus(part.data.status)
      const waiting = part.data.status === 'waiting_input' || part.data.status === 'waiting_approval'
      return {
        id: `activity-${index}`,
        kind: 'skill',
        label: '技能运行',
        status,
        critical: waiting || status === 'running' || status === 'error',
        expandable: true,
        parts: [part],
        streaming: streamActive || status === 'running',
      }
    }
    case 'data-tool-call-approval': {
      if (!part.data) return null
      return {
        id: `activity-${index}`,
        kind: 'approval',
        label: '等待确认',
        status: 'permission',
        critical: true,
        expandable: true,
        parts: [part],
      }
    }
    case 'data-error': {
      if (!part.data) return null
      return {
        id: `activity-${index}`,
        kind: 'error',
        label: typeof part.data.title === 'string' && part.data.title ? part.data.title : '请求失败',
        status: 'error',
        critical: true,
        expandable: Boolean(part.data.message),
        parts: [part],
      }
    }
    case 'data-research-run': {
      if (!part.data) return null
      const status = researchStatus(part.data.status)
      return {
        id: `activity-${index}`,
        kind: 'research',
        label: '深度研究',
        status,
        critical: status === 'running' || status === 'error' || status === 'permission',
        // Research remains a workbench entry, not a generic nested detail card.
        expandable: false,
        parts: [part],
        streaming: streamActive || status === 'running',
      }
    }
    default:
      return null
  }
}

function normalizeStatus(value: unknown): ChatActivityStatus {
  const status = String(value || '').toLowerCase()
  if (status === 'running' || status === 'in_progress' || status === 'pending') return 'running'
  if (status === 'error' || status === 'failed' || status === 'cancelled' || status === 'interrupted') return 'error'
  if (status === 'waiting' || status === 'waiting_input' || status === 'waiting_approval') return 'permission'
  if (status === 'success' || status === 'completed' || status === 'done') return 'success'
  return 'neutral'
}

function planStatus(value: unknown): ChatActivityStatus {
  const status = String(value || 'done').toLowerCase()
  if (status === 'executing' || status === 'proposing') return 'running'
  if (status === 'ready') return 'permission'
  if (status === 'discarded') return 'neutral'
  return normalizeStatus(status)
}

function skillStatus(value: unknown): ChatActivityStatus {
  return normalizeStatus(value)
}

function researchStatus(value: unknown): ChatActivityStatus {
  return normalizeStatus(value)
}

function workflowLabel(value: unknown): string {
  const name = String(value || '').toLowerCase()
  if (name.includes('deep') && name.includes('research')) return '深度研究'
  if (name.includes('search')) return '检索资料'
  if (name.includes('write') || name.includes('report')) return '撰写报告'
  return value ? humanize(String(value)) : '工作流'
}

function humanize(value: string): string {
  const label = String(value || '')
  return /[\u3400-\u9fff]/.test(label) ? label : '工作流'
}
