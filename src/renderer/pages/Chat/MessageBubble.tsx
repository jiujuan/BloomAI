import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Copy, Loader2, ThumbsUp, ThumbsDown, Check } from 'lucide-react'
import { cn } from '@renderer/utils'
import type { Message } from '@shared/schemas'

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
  streamText?: string
}

function CodeBlock({ children, className }: { children: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const lang = (className || '').replace('language-', '') || 'code'

  const copy = () => {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-lang">{lang}</span>
        <button className="code-copy-btn" onClick={copy} aria-label="Copy code">
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="code-body"><code>{children}</code></pre>
    </div>
  )
}

export function MessageBubble({ message, isStreaming, streamText }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false)
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const content = isStreaming ? (streamText || '') : message.content
  const isWaitingForStream = Boolean(isStreaming && !content)

  const copy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  if (isSystem) {
    return (
      <div className="msg-system">
        <span>{content}</span>
      </div>
    )
  }

  return (
    <div className={cn('msg-group', isUser && 'user')}>
      <div className={cn('msg-avatar', isUser && 'user')}>
        {isUser ? 'You' : 'AI'}
      </div>
      <div className="msg-col">
        <div className={cn('msg-bubble', isUser && 'user', isStreaming && 'streaming')}>
          {isUser ? (
            <p className="msg-text">{content}</p>
          ) : (
            isWaitingForStream ? (
              <div className="msg-waiting" role="status" aria-live="polite">
                <Loader2 size={15} className="msg-waiting-spinner" aria-hidden="true" />
                <span className="sr-only">Waiting for response</span>
              </div>
            ) : (
            <div className="msg-markdown">
              <ReactMarkdown
                components={{
                  code(props) {
                    const { children, className, node, ...rest } = props as any
                    const isBlock = /language-/.test(className || '')
                    if (isBlock) {
                      return <CodeBlock className={className}>{String(children).replace(/\n$/, '')}</CodeBlock>
                    }
                    return <code className="inline-code" {...rest}>{children}</code>
                  },
                  p: ({ children }) => <p className="md-p">{children}</p>,
                  ul: ({ children }) => <ul className="md-ul">{children}</ul>,
                  ol: ({ children }) => <ol className="md-ol">{children}</ol>,
                  li: ({ children }) => <li className="md-li">{children}</li>,
                  h1: ({ children }) => <h1 className="md-h1">{children}</h1>,
                  h2: ({ children }) => <h2 className="md-h2">{children}</h2>,
                  h3: ({ children }) => <h3 className="md-h3">{children}</h3>,
                  blockquote: ({ children }) => <blockquote className="md-blockquote">{children}</blockquote>,
                  strong: ({ children }) => <strong className="md-strong">{children}</strong>,
                  em: ({ children }) => <em>{children}</em>,
                  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="md-link">{children}</a>,
                }}
              >
                {content}
              </ReactMarkdown>
              {isStreaming && <span className="streaming-cursor" aria-hidden="true" />}
            </div>
            )
          )}
        </div>
        {!isUser && !isStreaming && content && (
          <div className="msg-actions">
            <button className="msg-action-btn" onClick={copy} title="Copy" aria-label="Copy message">
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
            <button className="msg-action-btn" title="Thumbs up" aria-label="Good response">
              <ThumbsUp size={12} />
            </button>
            <button className="msg-action-btn" title="Thumbs down" aria-label="Bad response">
              <ThumbsDown size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
