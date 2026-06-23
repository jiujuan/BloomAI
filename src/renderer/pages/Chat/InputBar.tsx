import React, { useState, useRef, useEffect } from 'react'
import { Send, Paperclip, Mic, Slash } from 'lucide-react'
import { cn } from '@renderer/utils'

interface InputBarProps {
  onSend: (content: string) => void
  disabled?: boolean
  placeholder?: string
}

export function InputBar({ onSend, disabled = false, placeholder }: InputBarProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [value])

  const handleSend = () => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="input-area">
      <div className="input-row">
        <button className="input-icon-btn" title="Attach file" aria-label="Attach file" disabled>
          <Paperclip size={16} />
        </button>
        <button className="input-icon-btn" title="Voice input" aria-label="Voice input" disabled>
          <Mic size={16} />
        </button>
        <button className="input-icon-btn" title="Commands (type /)" aria-label="Commands" disabled>
          <Slash size={16} />
        </button>
        <textarea
          ref={textareaRef}
          className="input-box"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKey}
          placeholder={placeholder || 'Ask anything… or type / for commands'}
          rows={1}
          disabled={disabled}
          aria-label="Chat input"
          aria-multiline="true"
        />
        <button
          className={cn('send-btn', (!value.trim() || disabled) && 'disabled')}
          onClick={handleSend}
          disabled={!value.trim() || disabled}
          aria-label="Send message"
        >
          <Send size={15} />
        </button>
      </div>
    </div>
  )
}
