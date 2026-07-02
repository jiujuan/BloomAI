import React, { useEffect, useRef, useState } from 'react'
import { Copy, ThumbsUp, ClipboardPaste } from 'lucide-react'

// Content-copy actions for assistant answers:
//  - CopyButton: shown below the bubble on hover, copies the whole answer.
//  - SelectionMenu: a right-click menu over selected text, with 复制 / 点赞.
//  - CopyToast: a brief centered "已复制" confirmation, mounted once per panel.
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

const COPIED_EVENT = 'bloom:copied'

/** Fire the centered "已复制" toast (see CopyToast). */
export function emitCopied(message = '已复制') {
  window.dispatchEvent(new CustomEvent(COPIED_EVENT, { detail: message }))
}

/**
 * Wire a bubble element for the right-click selection menu (复制 / 点赞). Returns a ref to attach
 * to the bubble, the current menu state, an onContextMenu handler, and a close callback.
 * Shared by both assistant answers and user questions so they behave identically.
 */
export function useSelectionMenu<T extends HTMLElement = HTMLDivElement>() {
  const bubbleRef = useRef<T>(null)
  const [menu, setMenu] = useState<SelectionMenuState | null>(null)

  // Right-click over a selection inside this bubble → custom menu. With no selection we don't
  // preventDefault, so the native menu still works elsewhere. The range is captured so the menu
  // can restore the highlight (the right-click can otherwise move the native selection).
  const handleContextMenu = (e: React.MouseEvent) => {
    const sel = window.getSelection()
    const text = sel?.toString().trim() || ''
    if (!text || !sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    if (bubbleRef.current && bubbleRef.current.contains(range.commonAncestorContainer)) {
      e.preventDefault()
      setMenu({ x: e.clientX, y: e.clientY, text, range: range.cloneRange() })
    }
  }

  return { bubbleRef, menu, handleContextMenu, closeMenu: () => setMenu(null) }
}

/** Copy-the-whole-answer button. Lives in the hover-revealed .msg-actions row below the bubble. */
export function CopyButton({ getText }: { getText: () => string }) {
  const onClick = async () => {
    if (await writeClipboard(getText())) emitCopied()
  }
  return (
    <button className="msg-action-btn" onClick={onClick} title="复制全部" aria-label="复制回答">
      <Copy size={14} />
    </button>
  )
}

export interface SelectionMenuState {
  x: number
  y: number
  text: string
  /** The selection at right-click time, restored so the highlight survives the menu opening. */
  range: Range
}

/**
 * Context menu for a text selection inside an assistant bubble. Positioned at the cursor
 * (fixed, viewport coords). Closes on outside click / scroll / resize / Escape.
 *
 * The right-button mousedown (and the menu appearing under the cursor) can move the native
 * selection, so on open we re-apply the captured range to keep the original text highlighted.
 * 复制 copies the captured text, clears the selection, and shows the toast; 点赞 signals a like.
 */
export function SelectionMenu({
  state,
  onClose,
  onLike,
}: {
  state: SelectionMenuState | null
  onClose: () => void
  /** Omit to hide the 点赞 item (e.g. on the user's own question). */
  onLike?: () => void
}) {
  useEffect(() => {
    if (!state) return
    // Re-apply the selection after paint: the mouse events around the right-click may have
    // collapsed or moved it, so this restores the exact text the user highlighted.
    const raf = requestAnimationFrame(() => {
      const sel = window.getSelection()
      if (sel) {
        sel.removeAllRanges()
        sel.addRange(state.range)
      }
    })
    const close = () => onClose()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    document.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('mousedown', close)
      document.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [state, onClose])

  if (!state) return null

  const copy = async () => {
    const ok = await writeClipboard(state.text)
    window.getSelection()?.removeAllRanges() // clear the highlight once copied
    onClose()
    if (ok) emitCopied()
  }
  const like = () => {
    onLike?.()
    onClose()
  }

  return (
    <div
      className="selection-menu"
      style={{ top: state.y, left: state.x }}
      role="menu"
      // preventDefault keeps the mousedown from stealing focus / collapsing the selection;
      // stopPropagation keeps the outside-click listener from closing us before onClick runs.
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button className="selection-menu-item" role="menuitem" onClick={copy}>
        <Copy size={13} />
        <span>复制</span>
      </button>
      {onLike && (
        <button className="selection-menu-item" role="menuitem" onClick={like}>
          <ThumbsUp size={13} />
          <span>点赞</span>
        </button>
      )}
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

/**
 * Context menu with a single 粘贴 item for the chat input. Positioned at the cursor.
 * Closes on outside click / scroll / resize / Escape. onPaste reads the clipboard and
 * inserts it at the caret (see the input's contextmenu handler).
 */
export function PasteMenu({
  state,
  onClose,
  onPaste,
}: {
  state: { x: number; y: number } | null
  onClose: () => void
  onPaste: () => void
}) {
  useEffect(() => {
    if (!state) return
    const close = () => onClose()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
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

  return (
    <div
      className="selection-menu"
      style={{ top: state.y, left: state.x }}
      role="menu"
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button className="selection-menu-item" role="menuitem" onClick={onPaste}>
        <ClipboardPaste size={13} />
        <span>粘贴</span>
      </button>
    </div>
  )
}

/**
 * Brief centered "已复制" confirmation. Mount once inside the chat panel; any copy action
 * (hover button or selection menu) fires the toast via emitCopied(). Auto-dismisses.
 */
export function CopyToast() {
  const [toast, setToast] = useState<{ id: number; msg: string } | null>(null)
  const idRef = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    const onCopied = (e: Event) => {
      const detail = (e as CustomEvent).detail
      setToast({ id: ++idRef.current, msg: typeof detail === 'string' && detail ? detail : '已复制' })
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setToast(null), 1200)
    }
    window.addEventListener(COPIED_EVENT, onCopied as EventListener)
    return () => {
      window.removeEventListener(COPIED_EVENT, onCopied as EventListener)
      clearTimeout(timer.current)
    }
  }, [])
  if (!toast) return null
  // key restarts the fade animation on each successive copy.
  return (
    <div key={toast.id} className="copy-toast" role="status" aria-live="polite">
      {toast.msg}
    </div>
  )
}
