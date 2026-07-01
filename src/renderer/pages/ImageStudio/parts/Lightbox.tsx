import React, { useEffect } from 'react'
import { X } from 'lucide-react'

export function Lightbox({ src, alt, onClose }: { src: string; alt?: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="img-lightbox" onClick={onClose} role="dialog" aria-modal="true">
      <button className="img-lightbox-close" onClick={onClose} aria-label="关闭"><X size={20} /></button>
      <img className="img-lightbox-img" src={src} alt={alt || ''} onClick={e => e.stopPropagation()} />
    </div>
  )
}
