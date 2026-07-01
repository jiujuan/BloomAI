import React, { useEffect, useRef } from 'react'
import { Sparkles } from 'lucide-react'
import { useImageStore } from '@renderer/store'
import { CopyToast } from '../Chat/MessageActions'
import { ImageComposer } from './ImageComposer'
import { GenerationCard } from './parts/GenerationCard'

/** Middle column: generated-image conversation stream + composer. */
export function ImageChatPanel() {
  const { activeSessionId, generationsBySession } = useImageStore()
  const gens = (activeSessionId && generationsBySession[activeSessionId]) || []
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [gens.length])

  return (
    <div className="img-chat-panel">
      <div className="img-stream" ref={scrollRef}>
        {gens.length === 0 ? (
          <div className="img-empty">
            <Sparkles size={28} className="img-empty-icon" />
            <h2>描述你想要的图片</h2>
            <p>选择模型 · 比例 · 风格，或从右侧模板「做同款」</p>
          </div>
        ) : (
          <div className="img-stream-inner">
            {gens.map(g => <GenerationCard key={g.id} gen={g} />)}
          </div>
        )}
      </div>
      <ImageComposer />
      <CopyToast />
    </div>
  )
}
