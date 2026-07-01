import React, { useEffect } from 'react'
import { useImageStore, useLlmStore } from '@renderer/store'
import { ImageSessionList } from './ImageSessionList'
import { ImageChatPanel } from './ImageChatPanel'
import { TemplateGallery } from './TemplateGallery'

/** AI 画图 (Image Studio) — independent three-column page: sessions | chat+images | templates. */
export function ImageStudioPage() {
  const loadSessions = useImageStore(s => s.loadSessions)
  const { loadModels } = useLlmStore()

  useEffect(() => {
    loadSessions()
    loadModels()
  }, [])

  return (
    <div className="image-studio">
      <ImageSessionList />
      <ImageChatPanel />
      <TemplateGallery />
    </div>
  )
}
