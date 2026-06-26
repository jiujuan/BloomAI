import React, { useEffect, useRef } from 'react'
import { MessageBubble } from './MessageBubble'
import { ToolCallCard } from './ToolCallCard'
import { ToolCallGroupCard, createToolCallGroupKey, type ToolCallGroup } from './ToolCallGroupCard'
import type { ToolCallState } from '@renderer/store'
import type { StreamingResponseState } from '@renderer/store/chat-response-reducer'
import { formatDate } from '@renderer/utils'
import type { Message, ResponseContentBlock } from '@shared/schemas'

interface TimelineProps {
  messages: Message[]
  isStreaming: boolean
  streamingText: string
  streamError: string | null
  toolCalls?: ToolCallState[]
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

export function shouldShowStreamingBubble(isStreaming: boolean, streamingText: string): boolean {
  return isStreaming || streamingText.length > 0
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
  streamingText,
  streamError,
  toolCalls = [],
  streamingResponse = null,
}: TimelineProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const activeBlocks = streamingResponse?.blocks ?? null

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, isStreaming, streamingText, toolCalls.length, activeBlocks?.length])

  // Group messages by date
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
      {messages.length === 0 && !isStreaming && (
        <div className="timeline-empty">
          <div className="timeline-empty-icon">🌸</div>
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

      {activeBlocks
        ? groupStreamingBlocks(activeBlocks).map(renderStreamingItem)
        : (
          <>
            {toolCallItems}

            {shouldShowStreamingBubble(isStreaming, streamingText) && (
              <MessageBubble
                message={{ id: 'streaming', session_id: '', role: 'assistant', content: '', created_at: Date.now() }}
                isStreaming
                streamText={streamingText}
              />
            )}
          </>
        )}

      {streamError && (
        <div className="stream-error" role="alert">
          <span>Warning: {streamError}</span>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}

type StreamingRenderItem = ResponseContentBlock | { type: 'tool_call_group'; group: ToolCallGroup }

function groupStreamingBlocks(blocks: ResponseContentBlock[]): StreamingRenderItem[] {
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
        message={{ id: block.id, session_id: '', role: 'assistant', content: '', created_at: block.createdAt }}
        isStreaming={block.status === 'streaming' || block.status === 'pending'}
        streamText={block.markdown}
      />
    )
  }

  if (block.type === 'tool_call') {
    return <ToolCallCard key={block.id} data={block} />
  }

  if (block.type === 'error') {
    return (
      <div key={block.id} className="stream-error" role="alert">
        <span>Warning: {block.error.message}</span>
      </div>
    )
  }

  return null
}
