import React, { useState } from 'react'
import { Copy, Download, Maximize2, RefreshCw, Wand2, AlertCircle } from 'lucide-react'
import { imageMediaUrl, type ImageGenerationRecord } from '@renderer/api'
import { useImageStore } from '@renderer/store'
import { getAspectRatio, getImageStyle } from '@shared/image-gen'
import { Lightbox } from './Lightbox'

/** One generated image: prompt bubble + result card (loading / completed / failed). */
export function GenerationCard({ gen }: { gen: ImageGenerationRecord }) {
  const { setComposer, generate, composer } = useImageStore()
  const [lightbox, setLightbox] = useState(false)
  const [copied, setCopied] = useState(false)

  const ratio = getAspectRatio(gen.aspect_ratio)
  const style = getImageStyle(gen.style)
  const isReal = !gen.id.startsWith('temp-')
  const src = gen.status === 'completed' && isReal ? imageMediaUrl(gen.id) : null

  const badges = [gen.model, ratio?.label, style?.label].filter(Boolean) as string[]

  const download = () => {
    if (!src) return
    const a = document.createElement('a')
    a.href = src
    a.download = `bloomai-${gen.id}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const copy = async () => {
    if (!src) return
    try {
      const blob = await (await fetch(src)).blob()
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (e) {
      console.error('copy image', e)
    }
  }

  const applySame = () => {
    setComposer({
      prompt: gen.prompt,
      model: gen.model || composer.model,
      aspectRatioId: gen.aspect_ratio || composer.aspectRatioId,
      styleId: gen.style,
    })
  }

  const redraw = () => {
    setComposer({
      prompt: gen.prompt,
      model: gen.model || composer.model,
      aspectRatioId: gen.aspect_ratio || composer.aspectRatioId,
      styleId: gen.style,
    })
    generate()
  }

  return (
    <div className="img-gen">
      <div className="img-gen-prompt">
        <span className="img-gen-bubble">{gen.prompt}</span>
        {badges.length > 0 && <span className="img-gen-badges">{badges.join(' · ')}</span>}
      </div>

      <div className="img-gen-result">
        {gen.status === 'in_progress' && (
          <div className="img-gen-skeleton" role="status" aria-label="生成中">
            <div className="img-gen-shimmer" />
            <span className="img-gen-status-text">正在生成…</span>
          </div>
        )}

        {gen.status === 'failed' && (
          <div className="img-gen-error" role="alert">
            <AlertCircle size={16} />
            <span>{gen.error_msg || '生成失败'}</span>
            <button className="btn-secondary btn-xs" onClick={redraw}>重试</button>
          </div>
        )}

        {gen.status === 'completed' && src && (
          <div className="img-gen-figure">
            <img className="img-gen-img" src={src} alt={gen.prompt} onClick={() => setLightbox(true)} />
            <div className="img-gen-actions">
              <button className="img-action" onClick={download} title="下载"><Download size={15} /></button>
              <button className="img-action" onClick={copy} title={copied ? '已复制' : '复制'}><Copy size={15} /></button>
              <button className="img-action" onClick={() => setLightbox(true)} title="查看大图"><Maximize2 size={15} /></button>
              <button className="img-action" onClick={redraw} title="重绘"><RefreshCw size={15} /></button>
              <button className="img-action" onClick={applySame} title="做同款"><Wand2 size={15} /></button>
            </div>
          </div>
        )}
      </div>

      {lightbox && src && <Lightbox src={src} alt={gen.prompt} onClose={() => setLightbox(false)} />}
    </div>
  )
}
