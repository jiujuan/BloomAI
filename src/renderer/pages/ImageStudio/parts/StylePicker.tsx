import React from 'react'
import { Check, Palette } from 'lucide-react'
import { useImageStore } from '@renderer/store'
import { IMAGE_STYLES, getImageStyle } from '@shared/image-gen'
import { ChipMenu } from './ChipMenu'

/** Style selector chip (参考图 3). Maps to a prompt-enhancement suffix; supports 不限. */
export function StylePicker() {
  const { composer, setComposer } = useImageStore()
  const current = getImageStyle(composer.styleId)

  return (
    <ChipMenu icon={<Palette size={14} />} label={`风格 ${current?.label ?? ''}`} title="图片风格" menuLabel="选择图片风格">
      {(close) => (
        <>
          <div className="img-menu-header">风格</div>
          <button
            type="button"
            role="option"
            aria-selected={!composer.styleId}
            className="img-menu-item"
            onClick={() => { setComposer({ styleId: null }); close() }}
          >
            <span className="img-menu-item-main">不限</span>
            {!composer.styleId && <Check size={14} className="img-menu-check" />}
          </button>
          {IMAGE_STYLES.map(s => (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={s.id === composer.styleId}
              className="img-menu-item"
              onClick={() => { setComposer({ styleId: s.id }); close() }}
            >
              <span className="img-style-thumb" aria-hidden data-style={s.id} />
              <span className="img-menu-item-main">{s.label}</span>
              {s.id === composer.styleId && <Check size={14} className="img-menu-check" />}
            </button>
          ))}
        </>
      )}
    </ChipMenu>
  )
}
