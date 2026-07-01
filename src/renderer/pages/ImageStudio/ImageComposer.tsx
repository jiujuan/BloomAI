import React, { useRef, useState } from 'react'
import { ImageIcon, Sparkles } from 'lucide-react'
import { useImageStore } from '@renderer/store'
import { cn } from '@renderer/utils'
import { ModelPicker } from './parts/ModelPicker'
import { AspectRatioPicker } from './parts/AspectRatioPicker'
import { StylePicker } from './parts/StylePicker'
import { ReferenceImageInput } from './parts/ReferenceImageInput'
import { filesToDataUris, imagesFromDataTransfer } from './parts/image-file'

/** Prompt input + toolbar chips (model / ratio / style / reference / optimize) + generate. */
export function ImageComposer() {
  const { composer, setComposer, addReferenceImages, generate, generating } = useImageStore()
  const taRef = useRef<HTMLTextAreaElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const canGenerate = composer.prompt.trim().length > 0 && !!composer.model && !generating

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canGenerate) generate()
    }
  }

  const onPaste = async (e: React.ClipboardEvent) => {
    const files = imagesFromDataTransfer(e.clipboardData)
    if (files.length) {
      e.preventDefault()
      addReferenceImages(await filesToDataUris(files))
    }
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = imagesFromDataTransfer(e.dataTransfer)
    if (files.length) addReferenceImages(await filesToDataUris(files))
  }

  return (
    <div
      className={cn('img-composer', dragOver && 'drag-over')}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <textarea
        ref={taRef}
        className="img-composer-input"
        placeholder="描述你想要的图片（Enter 生成，Shift+Enter 换行，可粘贴/拖拽参考图）"
        value={composer.prompt}
        onChange={e => setComposer({ prompt: e.target.value })}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        rows={2}
      />
      <div className="img-composer-toolbar">
        <div className="img-composer-left">
          <span className="img-chip static" title="当前模式：图像生成">
            <ImageIcon size={14} />
            <span className="img-chip-label">图像生成</span>
          </span>
          <ModelPicker />
          <AspectRatioPicker />
          <StylePicker />
          <ReferenceImageInput />
          <button
            type="button"
            className={cn('img-chip toggle', composer.optimize && 'on')}
            onClick={() => setComposer({ optimize: !composer.optimize })}
            title="智能优化提示词"
            aria-pressed={composer.optimize}
          >
            <Sparkles size={14} />
            <span className="img-chip-label">智能优化</span>
            <span className={cn('img-chip-dot', composer.optimize && 'on')} />
          </button>
        </div>
        <button className="img-generate" onClick={() => generate()} disabled={!canGenerate}>
          {generating ? '生成中…' : '生成'}
        </button>
      </div>
    </div>
  )
}
