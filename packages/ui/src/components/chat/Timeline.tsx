import React, { useEffect, useRef } from 'react'
import { MessageBubble } from './MessageBubble'
import { formatDate } from '../../lib/utils'
import type { Message } from '../../lib/schemas/index'

interface TimelineProps {
  messages: Message[]
  isStreaming: boolean
  streamingText: string
  streamError: string | null
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

function SystemBadge({ text }: { text: string }) {
  return (
    <div className="timeline-system-badge">
      <span>{text}</span>
    </div>
  )
}

export function Timeline({ messages, isStreaming, streamingText, streamError }: TimelineProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, isStreaming, streamingText])

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

  return (
    <div className="timeline" role="log" aria-label="Conversation" aria-live="polite">
      {messages.length === 0 && !isStreaming && (
        <div className="timeline-empty">
          <div className="timeline-empty-icon">🌸</div>
          <h2 className="timeline-empty-title">BloomAI is ready</h2>
          <p className="timeline-empty-desc">Ask me anything — I'm here to help with coding, writing, analysis, and more.</p>
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

      {isStreaming && streamingText && (
        <MessageBubble
          message={{ id: 'streaming', session_id: '', role: 'assistant', content: '', created_at: Date.now() }}
          isStreaming
          streamText={streamingText}
        />
      )}

      {streamError && (
        <div className="stream-error" role="alert">
          <span>⚠ {streamError}</span>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
