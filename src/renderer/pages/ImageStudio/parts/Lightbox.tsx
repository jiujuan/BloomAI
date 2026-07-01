import React, { useEffect } from 'react'
import { Download, X } from 'lucide-react'

export function Lightbox({ src, alt, onClose, onDownload }: { src: string; alt?: string; onClose: () => void; onDownload?: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="img-lightbox" onClick={onClose} role="dialog" aria-modal="true">
      <div className="img-lightbox-toolbar" onClick={e => e.stopPropagation()}>
        {onDownload && (
          <button className="img-lightbox-btn" onClick={onDownload} title="下载">
            <Download size={18} />
          </button>
        )}
        <button className="img-lightbox-btn" onClick={onClose} aria-label="关闭">
          <X size={18} />
        </button>
      </div>
      <img className="img-lightbox-img" src={src} alt={alt || ''} onClick={e => e.stopPropagation()} />
    </div>
  )
}
