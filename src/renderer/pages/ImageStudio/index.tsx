import React, { useEffect, useState } from 'react'
import { useImageStore, useLlmStore } from '@renderer/store'
import { ImageSessionList } from './ImageSessionList'
import { ImageChatPanel } from './ImageChatPanel'
import { TemplateGallery } from './TemplateGallery'
import { ArticleIllustrationWorkbench } from './ArticleIllustrationWorkbench'

export function ImageStudioPage() {
  const loadSessions = useImageStore(s => s.loadSessions)
  const { loadModels } = useLlmStore()
  const [mode, setMode] = useState<'single' | 'article'>('single')
  useEffect(() => { loadSessions(); loadModels() }, [])
  return <div className={mode === 'single' ? 'image-studio' : 'image-studio image-studio-article'}>
    <div className="image-studio-mode" role="tablist" aria-label="Image Studio mode"><button role="tab" aria-selected={mode === 'single'} onClick={() => setMode('single')}>Single image</button><button role="tab" aria-selected={mode === 'article'} onClick={() => setMode('article')}>Article illustration</button></div>
    {mode === 'single' ? <><ImageSessionList /><ImageChatPanel /><TemplateGallery /></> : <ArticleIllustrationWorkbench />}
  </div>
}