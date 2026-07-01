import React, { useEffect } from 'react'
import { Check, Sparkles } from 'lucide-react'
import { useImageStore, useLlmStore } from '@renderer/store'
import { IMAGE_MODEL_CAPS } from '@shared/image-gen'
import { ChipMenu } from './ChipMenu'

/** Model selector chip (参考图 1). Lists enabled image models from the LLM registry. */
export function ModelPicker() {
  const { imageModels, loadModels } = useLlmStore()
  const { composer, setComposer } = useImageStore()

  useEffect(() => {
    if (imageModels.length === 0) loadModels()
  }, [])

  // Default to the first available image model once loaded.
  useEffect(() => {
    if (!composer.model && imageModels[0]) setComposer({ model: imageModels[0].modelId })
  }, [imageModels, composer.model])

  const current = imageModels.find(m => m.modelId === composer.model)
  const label = current?.label || composer.model || '选择模型'

  return (
    <ChipMenu icon={<Sparkles size={14} />} label={label} title="画图模型" menuLabel="选择画图模型">
      {(close) => (
        <>
          <div className="img-menu-header">画图模型</div>
          {imageModels.length === 0 && <div className="img-menu-empty">暂无可用模型</div>}
          {imageModels.map(m => {
            const caps = IMAGE_MODEL_CAPS[m.modelId] || {}
            return (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={m.modelId === composer.model}
                className="img-menu-item"
                onClick={() => { setComposer({ model: m.modelId }); close() }}
              >
                <span className="img-menu-item-main">{m.label}</span>
                <span className="img-menu-badges">
                  {caps.supportsImg2Img && <span className="img-badge">图生图</span>}
                  {caps.async && <span className="img-badge">异步</span>}
                </span>
                {m.modelId === composer.model && <Check size={14} className="img-menu-check" />}
              </button>
            )
          })}
        </>
      )}
    </ChipMenu>
  )
}
