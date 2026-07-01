import React from 'react'
import { Check, Ratio } from 'lucide-react'
import { useImageStore } from '@renderer/store'
import { ASPECT_RATIOS, getAspectRatio } from '@shared/image-gen'
import { ChipMenu } from './ChipMenu'

/** Aspect-ratio selector chip (参考图 2). Each option shows value + semantic hint. */
export function AspectRatioPicker() {
  const { composer, setComposer } = useImageStore()
  const current = getAspectRatio(composer.aspectRatioId)

  return (
    <ChipMenu icon={<Ratio size={14} />} label={`比例 ${current?.label ?? ''}`} title="图片比例" menuLabel="选择图片比例">
      {(close) => (
        <>
          <div className="img-menu-header">比例</div>
          {ASPECT_RATIOS.map(r => (
            <button
              key={r.id}
              type="button"
              role="option"
              aria-selected={r.id === composer.aspectRatioId}
              className="img-menu-item"
              onClick={() => { setComposer({ aspectRatioId: r.id }); close() }}
            >
              <span className={`img-ratio-glyph ${r.orientation}`} aria-hidden />
              <span className="img-menu-item-main">
                <b>{r.label}</b> <span className="img-menu-hint">{r.hint}</span>
              </span>
              {r.id === composer.aspectRatioId && <Check size={14} className="img-menu-check" />}
            </button>
          ))}
        </>
      )}
    </ChipMenu>
  )
}
