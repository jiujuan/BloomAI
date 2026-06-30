import React, { useState } from 'react'
import { Brain, ChevronDown } from 'lucide-react'
import { cn } from '@renderer/utils'

/** Collapsible reasoning ("deep thinking") block from AI SDK reasoning parts. */
export function ReasoningPart({ text, streaming }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(true)
  if (!text && !streaming) return null
  return (
    <div className={cn('reasoning-block', streaming && 'streaming')} data-role="reasoning">
      <button className="reasoning-head" type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Brain size={12} />
        <span>思考{streaming ? '中…' : ''}</span>
        <ChevronDown size={12} className={cn('reasoning-chevron', open && 'open')} />
      </button>
      {open && <div className="reasoning-text">{text}</div>}
    </div>
  )
}
