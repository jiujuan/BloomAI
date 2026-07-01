import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@renderer/utils'

/**
 * A composer toolbar chip that opens a popover menu above it (matching the Chat composer's
 * dropdown behaviour). Closes on outside-click or Escape.
 */
export interface ChipMenuProps {
  icon?: React.ReactNode
  label: React.ReactNode
  title?: string
  disabled?: boolean
  menuLabel?: string
  children: (close: () => void) => React.ReactNode
}

export function ChipMenu({ icon, label, title, disabled, menuLabel, children }: ChipMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="img-chip-wrap" ref={ref}>
      <button
        type="button"
        className={cn('img-chip', open && 'active')}
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {icon}
        <span className="img-chip-label">{label}</span>
        <ChevronDown size={13} className={cn('img-chip-caret', open && 'up')} />
      </button>
      {open && (
        <div className="img-menu" role="listbox" aria-label={menuLabel}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
