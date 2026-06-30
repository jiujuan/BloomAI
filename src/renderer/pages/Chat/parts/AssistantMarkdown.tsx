import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy, Check } from 'lucide-react'

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

/** Assistant markdown renderer, shared by streaming text parts. Mirrors the prior MessageBubble markdown setup. */
export function AssistantMarkdown({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <div className="msg-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const { children, className, node, ...rest } = props as any
            if (/language-/.test(className || '')) {
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
        {text}
      </ReactMarkdown>
      {streaming && <span className="streaming-cursor" aria-hidden="true" />}
    </div>
  )
}
