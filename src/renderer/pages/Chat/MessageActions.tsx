import React, { useEffect, useState } from 'react'
import { Copy, Check, ThumbsUp } from 'lucide-react'

// Content-copy actions for assistant answers:
//  - CopyButton: shown below the bubble on hover, copies the whole answer.
//  - SelectionMenu: a right-click menu over selected text, with 复制 / 点赞.
// Self-contained and reusable — the parent only wires a bubble ref + contextmenu handler.

/** Concatenate an assistant message's text parts into one plain-text (markdown source) string. */
export function assistantPlainText(parts: any[]): string {
  if (!Array.isArray(parts)) return ''
  return parts
    .filter((p) => p?.type === 'text')
    .map((p) => p?.text || '')
    .join('')
    .trim()
}

async function writeClipboard(text: string): Promise<boolean> {
  if (!text) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Copy-the-whole-answer button. Lives in the hover-revealed .msg-actions row below the bubble. */
export function CopyButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false)
  const onClick = async () => {
    if (await writeClipboard(getText())) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }
  return (
    <button className="msg-action-btn" onClick={onClick} title="复制全部" aria-label="复制回答">
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  )
}

export interface SelectionMenuState {
  x: number
  y: number
  text: string
}

/**
 * Context menu for a text selection inside an assistant bubble. Positioned at the cursor
 * (fixed, viewport coords). Closes on outside click / scroll / resize / Escape. 复制 copies the
 * selected text; 点赞 signals a like back to the parent.
 */
export function SelectionMenu({
  state,
  onClose,
  onLike,
}: {
  state: SelectionMenuState | null
  onClose: () => void
  onLike: () => void
}) {
  useEffect(() => {
    if (!state) return
    const close = () => onClose()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // The opening right-click already fired its mousedown before these attach, so the menu
    // won't self-close; clicks inside the menu stopPropagation (see below).
    document.addEventListener('mousedown', close)
    document.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [state, onClose])

  if (!state) return null

  const copy = async () => {
    await writeClipboard(state.text)
    onClose()
  }
  const like = () => {
    onLike()
    onClose()
  }

  return (
    <div
      className="selection-menu"
      style={{ top: state.y, left: state.x }}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button className="selection-menu-item" role="menuitem" onClick={copy}>
        <Copy size={13} />
        <span>复制</span>
      </button>
      <button className="selection-menu-item" role="menuitem" onClick={like}>
        <ThumbsUp size={13} />
        <span>点赞</span>
      </button>
    </div>
  )
}

/** Small filled thumbs-up shown in the actions row once the user has liked the answer. */
export function LikedBadge() {
  return (
    <span className="msg-action-btn liked" title="已点赞" aria-label="已点赞">
      <ThumbsUp size={14} fill="currentColor" />
    </span>
  )
}
