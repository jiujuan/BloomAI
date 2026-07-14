import React, { useEffect } from 'react'
import { useImageStore, useLlmStore } from '@renderer/store'
import { ImageSessionList } from './ImageSessionList'
import { ImageChatPanel } from './ImageChatPanel'
import { TemplateGallery } from './TemplateGallery'

export function ImageStudioPage() {
  const loadSessions = useImageStore((store) => store.loadSessions)
  const loadModels = useLlmStore((store) => store.loadModels)

  useEffect(() => {
    loadSessions()
    loadModels()
  }, [loadModels, loadSessions])

  return (
    <div className="image-studio">
      <ImageSessionList />
      <ImageChatPanel />
      <TemplateGallery />
    </div>
  )
}
