import { beforeEach, describe, expect, it } from 'vitest'
import { useArticleIllustrationStore } from './article-illustration.store'

const scene = (id: string, ordinal: number, title: string) => ({ id, ordinal, title, excerpt: 'Excerpt', prompt: `${title} prompt`, status: 'planned', generation_id: null, error_message: null, retry_count: 0 })

describe('article illustration store', () => {
  beforeEach(() => useArticleIllustrationStore.getState().reset())

  it('keeps article mode state isolated and edits a planned scene', () => {
    const store = useArticleIllustrationStore.getState()
    store.setMode('article')
    store.setScenes([scene('scene-1', 1, 'Opening')])
    store.updateScene('scene-1', { prompt: 'Edited prompt' })
    expect(useArticleIllustrationStore.getState()).toMatchObject({ mode: 'article', scenes: [expect.objectContaining({ prompt: 'Edited prompt' })] })
  })

  it('adds, deletes, and reorders scenes while keeping sequential ordinals', () => {
    const store = useArticleIllustrationStore.getState()
    store.setScenes([scene('scene-1', 1, 'Opening'), scene('scene-2', 2, 'Closing')])
    store.moveScene('scene-2', -1)
    expect(useArticleIllustrationStore.getState().scenes.map(({ id, ordinal }) => ({ id, ordinal }))).toEqual([
      { id: 'scene-2', ordinal: 1 }, { id: 'scene-1', ordinal: 2 },
    ])

    store.removeScene('scene-2')
    store.addScene()
    expect(useArticleIllustrationStore.getState().scenes.map((current) => current.ordinal)).toEqual([1, 2])
    expect(useArticleIllustrationStore.getState().scenes).toHaveLength(2)
  })

  it('keeps drafts when switching the active article source mode', () => {
    const store = useArticleIllustrationStore.getState()
    store.setSource({ text: '保留的正文草稿' })
    store.setSourceMode('file')

    expect(useArticleIllustrationStore.getState()).toMatchObject({
      sourceMode: 'file',
      source: { text: '保留的正文草稿' },
    })
  })


  it('uses Chinese defaults for a newly added scene', () => {
    const store = useArticleIllustrationStore.getState()
    store.addScene()

    expect(useArticleIllustrationStore.getState().scenes).toEqual([
      expect.objectContaining({ title: '新场景', prompt: '请描述文章配图场景' }),
    ])
  })

  it('keeps the selected Skill when switching to the fallback route', () => {
    const store = useArticleIllustrationStore.getState()
    store.setExecution('skill', 'skill-version-1')
    store.setExecution('fallback')

    expect(useArticleIllustrationStore.getState()).toMatchObject({
      executionMode: 'fallback',
      selectedSkillVersionId: 'skill-version-1',
    })
  })

})