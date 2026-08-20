import React, { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  FileText,
  FolderOpen,
  ListTree,
  Loader2,
  Search,
  ShieldAlert,
} from 'lucide-react'
import { cn } from '@renderer/utils'
import { AssistantMarkdown } from './AssistantMarkdown'
import { ApprovalCard, toApprovalRequest } from './ApprovalCard'
import { AttachmentChips, type ChipItem } from './AttachmentChips'
import { PlanCard, type PlanStatus } from './PlanCard'
import { SkillRunPart } from './SkillRunPart'
import { ToolGroupCard } from './ToolGroupCard'
import { WorkflowSteps } from './WorkflowSteps'
import { isToolPart, toToolCallView, type ToolCallView } from './tool-part'
import {
  activityLabelForTool,
  activityStatusLabel,
  buildAssistantTurnModel,
  defaultActivityOpen,
  shouldShowWhenSummaryCollapsed,
  type ChatActivity,
  type ChatActivityKind,
  type ChatActivityStatus,
} from './chat-timeline'
import { assistantPlainText, CopyButton, LikedBadge, SelectionMenu, useSelectionMenu } from '../MessageActions'
import { ResearchRunPart, type ResearchRunPartData } from '../deepresearch/ResearchRunPart'

export type ChatTimelineApprovalProps = {
  decidedApprovals: Record<string, boolean>
  onDecide: (approvalId: string, approved: boolean) => void
}

export type AssistantTurnProps = ChatTimelineApprovalProps & {
  messageId: string
  parts: any[]
  streaming?: boolean
  onOpenResearchRun?: (runId: string) => void
}

export type UserQuestionProps = {
  parts: any[]
}

export type PlanProposalTurnProps = {
  query: string
  tasks: string[]
  status: PlanStatus
  onConfirm?: () => void
  onReplan?: () => void
}

export function UserQuestion({ parts }: UserQuestionProps): React.ReactElement {
  const text = parts.filter((part) => part?.type === 'text').map((part) => part.text || '').join('')
  const { bubbleRef, menu, handleContextMenu, closeMenu } = useSelectionMenu<HTMLDivElement>()
  const attachmentPart = parts.find((part) => part?.type === 'data-attachments')
  const files: ChipItem[] = Array.isArray(attachmentPart?.data?.files)
    ? attachmentPart.data.files.map((file: any) => ({ id: file.id, name: file.name, ext: file.ext, size: file.size }))
    : []

  return (
    <div className="msg-group user">
      <div className="msg-col">
        {files.length > 0 && <AttachmentChips items={files} compact />}
        {text && (
          <div ref={bubbleRef} onContextMenu={handleContextMenu} className="msg-bubble user">
            <p className="msg-text">{text}</p>
          </div>
        )}
        <SelectionMenu state={menu} onClose={closeMenu} />
      </div>
    </div>
  )
}

export function PendingAssistantTurn(): React.ReactElement {
  return (
    <div className="assistant-pending" role="status" aria-live="polite">
      <Loader2 size={15} className="msg-waiting-spinner" aria-hidden="true" />
      <span>正在思考…</span>
    </div>
  )
}

export function AssistantTurn({
  messageId,
  parts,
  streaming = false,
  decidedApprovals,
  onDecide,
  onOpenResearchRun,
}: AssistantTurnProps): React.ReactElement {
  const model = useMemo(() => buildAssistantTurnModel(parts, { streaming }), [parts, streaming])
  const { activities, answerParts } = model
  const safeMessageId = `chat-${String(messageId || 'message').replace(/[^a-zA-Z0-9_-]/g, '-')}`
  const hasPendingApproval = activities.some((activity) => activity.kind === 'approval' && decidedForActivity(activity, decidedApprovals) === undefined)
  const [summaryOpen, setSummaryOpen] = useState(() => activities.length > 0)
  const fullText = assistantPlainText(parts)
  const [liked, setLiked] = useState(false)
  const { bubbleRef, menu, handleContextMenu, closeMenu } = useSelectionMenu<HTMLDivElement>()

  useEffect(() => {
    if (streaming || hasPendingApproval) setSummaryOpen(true)
  }, [streaming, hasPendingApproval])

  const hasTextAnswer = answerParts.some((part) => typeof part?.text === 'string' && part.text.trim())
  const hasError = activities.some((activity) => activity.kind === 'error')
  const waitingAfterParts = streaming && !hasTextAnswer
  const showEmptyFallback = !streaming && !hasTextAnswer && (activities.length === 0 || hasError)
  const canCopy = !streaming && Boolean(fullText)

  const toggleSummary = () => {
    if (!hasPendingApproval) setSummaryOpen((open) => !open)
  }

  return (
    <div className="msg-group assistant-turn">
      <div className="msg-col assistant-turn-col">
        {activities.length > 0 && (
          <TurnActivitySummary
            messageId={safeMessageId}
            activities={activities}
            summaryOpen={summaryOpen}
            onToggle={toggleSummary}
            decidedApprovals={decidedApprovals}
            onDecide={onDecide}
            onOpenResearchRun={onOpenResearchRun}
            locked={hasPendingApproval}
          />
        )}
        <div ref={bubbleRef} onContextMenu={handleContextMenu} className="assistant-content">
          {answerParts.map((part, index) => (
            <AssistantMarkdown key={`answer-${index}`} text={part.text || ''} streaming={streaming && part.state === 'streaming'} />
          ))}
          {showEmptyFallback && <p className="msg-text msg-fallback">本次未能生成回答，请稍后重试。</p>}
          {waitingAfterParts && <PendingAssistantTurn />}
        </div>
        {(canCopy || liked) && (
          <div className={cn('msg-actions', liked && 'has-liked')}>
            {canCopy && <CopyButton getText={() => fullText} />}
            {liked && <LikedBadge />}
          </div>
        )}
        <SelectionMenu state={menu} onClose={closeMenu} onLike={() => setLiked(true)} />
      </div>
    </div>
  )
}

export function PlanProposalTurn({ query, tasks, status, onConfirm, onReplan }: PlanProposalTurnProps): React.ReactElement {
  return (
    <>
      <UserQuestion parts={[{ type: 'text', text: query }]} />
      <div className="msg-group assistant-turn">
        <div className="msg-col assistant-turn-col">
          <section className="assistant-activity-summary plan-proposal-summary" aria-label="执行计划">
            <div className="assistant-activity-summary-head static">
              <span>执行计划</span>
              {status === 'proposing' || status === 'executing' ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
            </div>
            <div className="assistant-activity-details plan-proposal-details">
              <PlanCard tasks={tasks} status={status} onConfirm={onConfirm} onReplan={onReplan} />
            </div>
          </section>
        </div>
      </div>
    </>
  )
}

export function TurnActivitySummary({
  messageId,
  activities,
  summaryOpen,
  onToggle,
  decidedApprovals,
  onDecide,
  onOpenResearchRun,
  locked = false,
}: {
  messageId: string
  activities: ChatActivity[]
  summaryOpen: boolean
  onToggle: () => void
  decidedApprovals: Record<string, boolean>
  onDecide: (approvalId: string, approved: boolean) => void
  onOpenResearchRun?: (runId: string) => void
  locked?: boolean
}): React.ReactElement {
  const detailId = `${messageId}-activities`
  const criticalActivities = activities.filter((activity) => shouldShowWhenSummaryCollapsed(activity))

  return (
    <section className="assistant-activity-summary" aria-label="助手工作摘要">
      <button
        type="button"
        className="assistant-activity-summary-head"
        aria-expanded={summaryOpen}
        aria-controls={detailId}
        aria-disabled={locked || undefined}
        onClick={onToggle}
      >
        <span>工作摘要</span>
        {summaryOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
      </button>
      {summaryOpen ? (
        <div id={detailId} className="assistant-activity-list" role="list">
          {activities.map((activity) => (
            <ActivityItem
              key={activity.id}
              messageId={messageId}
              activity={activity}
              decidedApprovals={decidedApprovals}
              onDecide={onDecide}
              onOpenResearchRun={onOpenResearchRun}
            />
          ))}
        </div>
      ) : criticalActivities.length > 0 ? (
        <div className="assistant-critical-activity-list" role="list" aria-label="关键状态">
          {criticalActivities.map((activity) => (
            <CriticalActivityRow key={activity.id} activity={activity} />
          ))}
        </div>
      ) : null}
    </section>
  )
}

function ActivityItem({
  messageId,
  activity,
  decidedApprovals,
  onDecide,
  onOpenResearchRun,
}: {
  messageId: string
  activity: ChatActivity
  decidedApprovals: Record<string, boolean>
  onDecide: (approvalId: string, approved: boolean) => void
  onOpenResearchRun?: (runId: string) => void
}): React.ReactElement {
  const [open, setOpen] = useState(() =>
    defaultActivityOpen(activity, { streaming: activity.streaming === true, historical: activity.streaming !== true }),
  )
  const detailsId = `${messageId}-${activity.id}-details`
  const approval = activity.kind === 'approval' ? toApprovalRequest(activity.parts[0]) : null
  const pendingApproval = approval ? decidedApprovals[approval.approvalId] === undefined : false

  useEffect(() => {
    if (activity.critical || pendingApproval) setOpen(true)
  }, [activity.critical, pendingApproval])

  const canOpenResearch = activity.kind === 'research' && Boolean(onOpenResearchRun)
  const staticRow = !activity.expandable && !canOpenResearch
  const rowContent = (
    <>
      <ActivityIcon kind={activity.kind} status={activity.status} />
      <span className="assistant-activity-label">{activity.label}</span>
      <ActivityStatus status={activity.status} />
      {activity.expandable && (open ? <ChevronDown className="assistant-activity-chevron" size={14} aria-hidden="true" /> : <ChevronRight className="assistant-activity-chevron" size={14} aria-hidden="true" />)}
      {canOpenResearch && <ExternalLink size={13} aria-hidden="true" />}
    </>
  )

  return (
    <div className={cn('assistant-activity-item', activity.status, activity.critical && 'critical')} role="listitem">
      {staticRow ? (
        <div className="assistant-activity-row static">{rowContent}</div>
      ) : (
        <button
          type="button"
          className={cn('assistant-activity-row', canOpenResearch && 'action')}
          aria-expanded={activity.expandable ? open : undefined}
          aria-controls={activity.expandable ? detailsId : undefined}
          aria-label={canOpenResearch ? '打开深度研究' : undefined}
          onClick={
            canOpenResearch
              ? () => {
                  const runId = activity.parts[0]?.data?.runId
                  if (runId) onOpenResearchRun?.(runId)
                }
              : activity.expandable
                ? () => setOpen((value) => !value)
                : undefined
          }
        >
          {rowContent}
        </button>
      )}
      {activity.expandable && open && (
        <div id={detailsId} className="assistant-activity-details">
          <ActivityDetails
            activity={activity}
            decidedApprovals={decidedApprovals}
            onDecide={onDecide}
            onOpenResearchRun={onOpenResearchRun}
          />
        </div>
      )}
    </div>
  )
}

function CriticalActivityRow({ activity }: { activity: ChatActivity }): React.ReactElement {
  return (
    <div className={cn('assistant-activity-row static critical', activity.status)} role="listitem">
      <ActivityIcon kind={activity.kind} status={activity.status} />
      <span className="assistant-activity-label">{activity.label}</span>
      <ActivityStatus status={activity.status} />
    </div>
  )
}

function ActivityDetails({
  activity,
  decidedApprovals,
  onDecide,
  onOpenResearchRun,
}: {
  activity: ChatActivity
  decidedApprovals: Record<string, boolean>
  onDecide: (approvalId: string, approved: boolean) => void
  onOpenResearchRun?: (runId: string) => void
}): React.ReactElement | null {
  switch (activity.kind) {
    case 'reasoning':
      return <div className="assistant-activity-text">{activity.parts.map((part) => part.text || '').join('')}</div>
    case 'tool': {
      const calls = activity.parts.filter(isToolPart).map(toToolCallView)
      const name = calls[0]?.name || activityLabelForTool(activity.label)
      return <ToolGroupCard name={name} calls={calls} detailsOnly />
    }
    case 'workflow':
      return <WorkflowSteps data={activity.parts[0]?.data} embedded />
    case 'plan': {
      const data = activity.parts[0]?.data || {}
      const tasks = Array.isArray(data.tasks) ? data.tasks : []
      return <PlanCard tasks={tasks} status="done" />
    }
    case 'skill':
      return <SkillRunPart data={activity.parts[0]?.data} />
    case 'approval': {
      const request = toApprovalRequest(activity.parts[0])
      if (!request) return null
      return <ApprovalCard request={request} decided={decidedApprovals[request.approvalId]} onDecide={onDecide} />
    }
    case 'error': {
      const data = activity.parts[0]?.data || {}
      return (
        <div className="timeline-error-block" role="alert">
          <div className="timeline-error-title">{data.title || '请求失败'}</div>
          <div className="timeline-error-message">{data.message || '请求出错了，请稍后重试。'}</div>
        </div>
      )
    }
    case 'research': {
      const data = activity.parts[0]?.data as ResearchRunPartData | undefined
      if (!data) return null
      return <ResearchRunPart data={data} onOpen={onOpenResearchRun || (() => {})} />
    }
    default:
      return null
  }
}

function ActivityIcon({ kind, status }: { kind: ChatActivityKind; status: ChatActivityStatus }): React.ReactElement {
  if (status === 'running') return <Loader2 size={14} className="spin assistant-activity-icon running" aria-hidden="true" />
  if (status === 'error') return <CircleAlert size={14} className="assistant-activity-icon error" aria-hidden="true" />
  if (status === 'permission') return <ShieldAlert size={14} className="assistant-activity-icon permission" aria-hidden="true" />
  if (status === 'success') return <Check size={14} className="assistant-activity-icon success" aria-hidden="true" />

  const icons: Record<ChatActivityKind, React.ReactElement> = {
    reasoning: <Brain size={14} />,
    tool: <FileText size={14} />,
    workflow: <ListTree size={14} />,
    plan: <ListTree size={14} />,
    skill: <FolderOpen size={14} />,
    approval: <ShieldAlert size={14} />,
    error: <AlertTriangle size={14} />,
    research: <Search size={14} />,
  }
  return <span className="assistant-activity-icon" aria-hidden="true">{icons[kind]}</span>
}

function ActivityStatus({ status }: { status: ChatActivityStatus }): React.ReactElement | null {
  const label = activityStatusLabel(status)
  return label ? <span className={cn('assistant-activity-status', status)} role={status === 'running' ? 'status' : undefined}>{label}</span> : null
}

function decidedForActivity(activity: ChatActivity, decidedApprovals: Record<string, boolean>): boolean | undefined {
  if (activity.kind !== 'approval') return undefined
  const request = toApprovalRequest(activity.parts[0])
  return request ? decidedApprovals[request.approvalId] : undefined
}
