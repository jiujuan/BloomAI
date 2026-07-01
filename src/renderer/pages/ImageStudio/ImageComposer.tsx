import React, { useEffect, useRef, useState } from 'react'
import { ImageIcon, Sparkles, ClipboardPaste } from 'lucide-react'
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
  const menuRef = useRef<HTMLDivElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)

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

  const onContextMenu = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }

  const closeMenu = () => setCtxMenu(null)

  // Close on outside click or Escape
  useEffect(() => {
    if (!ctxMenu) return
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) closeMenu()
    }
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu() }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keyup', onKeyUp)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keyup', onKeyUp)
    }
  }, [ctxMenu])

  const pasteText = async () => {
    closeMenu()
    let text = ''
    try { text = await navigator.clipboard.readText() } catch { return }
    if (!text) return
    const ta = taRef.current
    if (!ta) {
      setComposer({ prompt: composer.prompt + text })
      return
    }
    const start = ta.selectionStart ?? composer.prompt.length
    const end = ta.selectionEnd ?? composer.prompt.length
    const next = composer.prompt.slice(0, start) + text + composer.prompt.slice(end)
    setComposer({ prompt: next })
    // Restore cursor after React re-render
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(start + text.length, start + text.length)
    })
  }

  // Clamp menu position so it doesn't overflow the viewport
  const menuStyle = ctxMenu ? {
    left: Math.min(ctxMenu.x, window.innerWidth - 140),
    top: Math.min(ctxMenu.y, window.innerHeight - 60),
  } : {}

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
        onContextMenu={onContextMenu}
        rows={2}
      />

      {ctxMenu && (
        <div ref={menuRef} className="selection-menu" style={{ position: 'fixed', zIndex: 1000, ...menuStyle }}>
          <button className="selection-menu-item" onClick={pasteText}>
            <ClipboardPaste size={13} />
            粘贴
          </button>
        </div>
      )}

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
