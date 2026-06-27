import React, { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { MessageBubble } from './MessageBubble'
import { ToolCallCard } from './ToolCallCard'
import { ToolCallGroupCard, createToolCallGroupKey, type ToolCallGroup } from './ToolCallGroupCard'
import { deriveStreamingText, deriveToolCalls } from '@renderer/store/chat-response-reducer'
import type { StreamingResponseState } from '@renderer/store/chat-response-reducer'
import { formatDate } from '@renderer/utils'
import type { ErrorBlock, Message, ResponseContentBlock } from '@shared/schemas'
import { resolveErrorTimeline } from '@shared/llm-response-contract/error-timeline-registry'
import { getTimelineStateDefinition } from '@shared/llm-response-contract/timeline-state-registry'

interface TimelineProps {
  messages: Message[]
  isStreaming: boolean
  streamingResponse?: StreamingResponseState | null
}

function DateDivider({ label }: { label: string }) {
  return (
    <div className="timeline-date-divider" aria-label={label}>
      <div className="divider-line" />
      <span className="divider-label">{label}</span>
      <div className="divider-line" />
    </div>
  )
}

export function shouldShowStreamingBubble(
  isStreaming: boolean,
  streamingResponse: StreamingResponseState | null = null,
): boolean {
  if (streamingResponse) return false
  return isStreaming
}

function SystemBadge({ text }: { text: string }) {
  return (
    <div className="timeline-system-badge">
      <span>{text}</span>
    </div>
  )
}

export function Timeline({
  messages,
  isStreaming,
  streamingResponse = null,
}: TimelineProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const activeBlocks = streamingResponse?.blocks ?? null
  const activeStreamText = deriveStreamingText(streamingResponse)
  const toolCalls = deriveToolCalls(streamingResponse)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, isStreaming, activeStreamText, toolCalls.length, activeBlocks?.length])

  const grouped: Array<{ type: 'date'; label: string } | { type: 'message'; message: Message }> = []
  let lastDate = ''
  for (const msg of messages) {
    const date = formatDate(msg.created_at)
    if (date !== lastDate) {
      grouped.push({ type: 'date', label: date })
      lastDate = date
    }
    grouped.push({ type: 'message', message: msg })
  }

  const toolCallItems = toolCalls.map((call) => (
    <ToolCallCard key={call.callId} data={call} />
  ))

  return (
    <div className="timeline" role="log" aria-label="Conversation" aria-live="polite">
      {messages.length === 0 && !isStreaming && !streamingResponse && (
        <div className="timeline-empty">
          <div className="timeline-empty-icon">Bloom</div>
          <h2 className="timeline-empty-title">BloomAI is ready</h2>
          <p className="timeline-empty-desc">Ask me anything -I'm here to help with coding, writing, analysis, and more.</p>
          <div className="timeline-empty-suggestions">
            {['Explain this code', 'Write an email', 'Summarize this text', 'Help me brainstorm'].map(s => (
              <button key={s} className="suggestion-chip">{s}</button>
            ))}
          </div>
        </div>
      )}

      {grouped.map((item, i) =>
        item.type === 'date'
          ? <DateDivider key={`date-${i}`} label={item.label} />
          : <MessageBubble key={item.message.id} message={item.message} />
      )}

      {streamingResponse
        ? renderStreamingResponse(streamingResponse)
        : (
          <>
            {toolCallItems}

            {shouldShowStreamingBubble(isStreaming, streamingResponse) && (
              <MessageBubble
                message={{ id: 'streaming', session_id: '', role: 'assistant', content: '', created_at: Date.now() }}
                isStreaming
                streamText={activeStreamText}
              />
            )}
          </>
        )}

      <div ref={bottomRef} />
    </div>
  )
}

function renderStreamingResponse(response: StreamingResponseState) {
  if (response.blocks.length === 0 && !response.isComplete && !response.error) {
    return <TimelineWaitState />
  }
  return groupStreamingBlocks(response.blocks).map(renderStreamingItem)
}

function TimelineWaitState() {
  const definition = getTimelineStateDefinition('response_started_no_block')
  return (
    <div className="timeline-wait-state" role="status" aria-live="polite">
      <Loader2 size={13} className="spin" aria-hidden="true" />
      <span>{definition.label}</span>
    </div>
  )
}

type StreamingRenderItem = ResponseContentBlock | { type: 'tool_call_group'; group: ToolCallGroup }

export function groupStreamingBlocks(blocks: ResponseContentBlock[]): StreamingRenderItem[] {
  const items: StreamingRenderItem[] = []
  for (const block of blocks) {
    if (block.type !== 'tool_call') {
      items.push(block)
      continue
    }

    const key = createToolCallGroupKey(block)
    const previous = items[items.length - 1]
    if (previous && previous.type === 'tool_call_group' && previous.group.key === key) {
      previous.group.calls.push(block)
      continue
    }

    items.push({
      type: 'tool_call_group',
      group: { key, toolId: block.toolId, category: block.category, calls: [block] },
    })
  }
  return items
}

function renderStreamingItem(item: StreamingRenderItem) {
  if (item.type === 'tool_call_group') {
    return <ToolCallGroupCard key={item.group.calls.map((call) => call.callId).join(':')} group={item.group} />
  }
  return renderStreamingBlock(item)
}

function renderStreamingBlock(block: ResponseContentBlock) {
  if (block.type === 'markdown') {
    return (
      <MessageBubble
        key={block.id}
        message={{ id: block.id, session_id: '', role: 'assistant', content: block.markdown, created_at: block.createdAt }}
        isStreaming={block.status === 'streaming' || block.status === 'pending'}
        streamText={block.markdown}
      />
    )
  }

  if (block.type === 'tool_call') {
    return <ToolCallCard key={block.id} data={block} />
  }

  if (block.type === 'error') {
    return <TimelineErrorBlock key={block.id} block={block} />
  }

  if (block.type === 'artifact') {
    return <SystemBadge key={block.id} text={`${block.title} (${block.artifactType})`} />
  }

  if (block.type === 'citation') {
    return <SystemBadge key={block.id} text={`${block.citations.length} citations`} />
  }

  return null
}

function TimelineErrorBlock({ block }: { block: ErrorBlock }) {
  const definition = resolveErrorTimeline(block.error)
  return (
    <div className="timeline-error-block" role="alert" data-error-code={block.error.code}>
      <div className="timeline-error-title">{definition.timelineMessage}</div>
      <div className="timeline-error-message">{block.error.message}</div>
    </div>
  )
}
