import { FileText, FileSpreadsheet, FileType, X, Loader2, type LucideIcon } from 'lucide-react'
import { formatAttachmentSize } from '@shared/attachments'
import { cn } from '@renderer/utils'

/** One chip's view data. `status` is only set for chips in the composer (uploading/failed). */
export type ChipItem = {
  id: string
  name: string
  ext: string
  size: number
  status?: 'uploading' | 'error'
  error?: string
}

function iconFor(ext: string): LucideIcon {
  switch (ext.toLowerCase()) {
    case 'csv':
      return FileSpreadsheet
    case 'pdf':
      return FileType
    default:
      return FileText
  }
}

/**
 * Attachment chips. Editable in the composer (pass `onRemove`); read-only inside a sent user
 * message bubble (omit it). Uploading chips show a spinner; failed ones show the error inline.
 */
export function AttachmentChips({ items, onRemove }: { items: ChipItem[]; onRemove?: (id: string) => void }) {
  if (!items.length) return null
  return (
    <div className="attachment-chips">
      {items.map((it) => {
        const Icon = iconFor(it.ext)
        return (
          <div
            key={it.id}
            className={cn('attachment-chip', it.status === 'error' && 'error')}
            title={it.error || it.name}
          >
            {it.status === 'uploading' ? <Loader2 size={14} className="spin" /> : <Icon size={14} />}
            <span className="attachment-chip-name">{it.name}</span>
            <span className="attachment-chip-size">
              {it.status === 'error' ? it.error || '失败' : formatAttachmentSize(it.size)}
            </span>
            {onRemove && (
              <button
                type="button"
                className="attachment-chip-remove"
                onClick={() => onRemove(it.id)}
                title="移除"
                aria-label="移除附件"
              >
                <X size={12} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
