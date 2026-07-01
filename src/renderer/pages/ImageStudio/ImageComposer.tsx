import React, { useRef } from 'react'
import { ImageIcon, Sparkles } from 'lucide-react'
import { useImageStore } from '@renderer/store'
import { cn } from '@renderer/utils'
import { ModelPicker } from './parts/ModelPicker'
import { AspectRatioPicker } from './parts/AspectRatioPicker'
import { StylePicker } from './parts/StylePicker'

/** Prompt input + toolbar chips (model / ratio / style / optimize) + generate button. */
export function ImageComposer() {
  const { composer, setComposer, generate, generating } = useImageStore()
  const taRef = useRef<HTMLTextAreaElement>(null)

  const canGenerate = composer.prompt.trim().length > 0 && !!composer.model && !generating

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canGenerate) generate()
    }
  }

  return (
    <div className="img-composer">
      <textarea
        ref={taRef}
        className="img-composer-input"
        placeholder="描述你想要的图片（Enter 生成，Shift+Enter 换行）"
        value={composer.prompt}
        onChange={e => setComposer({ prompt: e.target.value })}
        onKeyDown={onKeyDown}
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
