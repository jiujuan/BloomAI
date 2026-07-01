import React, { useRef } from 'react'
import { ImagePlus, X } from 'lucide-react'
import { useImageStore, useLlmStore } from '@renderer/store'
import { IMAGE_MODEL_CAPS } from '@shared/image-gen'
import { cn } from '@renderer/utils'
import { filesToDataUris } from './image-file'

/**
 * 参考图 (img2img) input: file picker button + removable thumbnails. Disabled when the
 * selected model does not support image-to-image. Paste/drag are handled by the composer,
 * which calls addReferenceImages directly.
 */
export function ReferenceImageInput() {
  const { composer, addReferenceImages, removeReferenceImage } = useImageStore()
  const { imageModels } = useLlmStore()
  const inputRef = useRef<HTMLInputElement>(null)

  const caps = IMAGE_MODEL_CAPS[composer.model] || {}
  const supported = caps.supportsImg2Img !== false // allow unless explicitly false (e.g. dall-e-3)
  const full = composer.referenceImages.length >= 4

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addReferenceImages(await filesToDataUris(e.target.files))
    if (inputRef.current) inputRef.current.value = ''
  }

  const currentLabel = imageModels.find(m => m.modelId === composer.model)?.label || '该模型'

  return (
    <>
      <button
        type="button"
        className={cn('img-chip', composer.referenceImages.length > 0 && 'on')}
        onClick={() => !full && inputRef.current?.click()}
        disabled={!supported || full}
        title={supported ? '添加参考图（图生图）' : `${currentLabel} 暂不支持图生图`}
      >
        <ImagePlus size={14} />
        <span className="img-chip-label">参考图{composer.referenceImages.length > 0 ? ` ${composer.referenceImages.length}` : ' +'}</span>
      </button>
      <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={onPick} />

      {composer.referenceImages.length > 0 && (
        <div className="img-ref-thumbs">
          {composer.referenceImages.map((src, i) => (
            <div key={i} className="img-ref-thumb">
              <img src={src} alt={`参考图 ${i + 1}`} />
              <button className="img-ref-remove" onClick={() => removeReferenceImage(i)} title="移除" aria-label="移除参考图">
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
