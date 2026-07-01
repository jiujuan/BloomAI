import React, { useEffect, useState } from 'react'
import { Wand2 } from 'lucide-react'
import { platform } from '@renderer/api'
import { useImageStore } from '@renderer/store'
import { IMAGE_TEMPLATE_CATEGORIES, type ImageTemplateDef } from '@shared/image-templates'
import { cn } from '@renderer/utils'

/** Right column: template gallery. "做同款" copies the prompt + recommended params to composer. */
export function TemplateGallery() {
  const { applyTemplate, composer, setComposer } = useImageStore()
  const [templates, setTemplates] = useState<ImageTemplateDef[]>([])
  const [category, setCategory] = useState<string>('全部')

  useEffect(() => {
    platform.image.listTemplates(category).then(setTemplates).catch(e => console.error('listTemplates', e))
  }, [category])

  const onApply = (t: ImageTemplateDef) => {
    if (composer.prompt.trim() && composer.prompt !== t.prompt) {
      const append = window.confirm('输入框已有内容。确定替换为该模板？（取消则追加）')
      if (!append) {
        setComposer({ prompt: `${composer.prompt}\n${t.prompt}` })
        return
      }
    }
    applyTemplate(t)
  }

  return (
    <div className="img-template-panel">
      <div className="img-template-head">
        <span className="img-template-title">模板</span>
      </div>
      <div className="img-template-cats">
        {IMAGE_TEMPLATE_CATEGORIES.map(c => (
          <button
            key={c}
            className={cn('img-cat', category === c && 'active')}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="img-template-grid">
        {templates.map(t => (
          <div key={t.id} className="img-template-card">
            <div className="img-template-thumb" data-template={t.id}>
              {t.thumb ? <img src={t.thumb} alt={t.title} /> : <span className="img-template-thumb-label">{t.title}</span>}
            </div>
            <div className="img-template-meta">
              <div className="img-template-name">{t.title}</div>
              <div className="img-template-tags">{t.tags.map(tag => `#${tag}`).join(' ')}</div>
            </div>
            <button className="img-template-apply" onClick={() => onApply(t)}>
              <Wand2 size={13} /> 做同款
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
