import { create } from 'zustand'
import { platform } from '@renderer/api'
import type { ArticleIllustrationJob, ArticleIllustrationScene, ArticleSourceDraft, EligibleImageSkill } from './article-illustration.types'

type State = {
  mode: 'single' | 'article'
  source: ArticleSourceDraft
  sourceMode: 'text' | 'file'
  executionMode: 'skill' | 'fallback'
  selectedSkillVersionId: string | null
  config: { imageCount: number; model: string; aspectRatioId: string; styleId: string }
  eligibleSkills: EligibleImageSkill[]
  scenes: ArticleIllustrationScene[]
  activeJob: ArticleIllustrationJob | null
  recoverableJobs: ArticleIllustrationJob[]
  loading: boolean
  error: string | null
}
type Actions = {
  reset: () => void
  setMode: (mode: State['mode']) => void
  setSource: (patch: Partial<ArticleSourceDraft>) => void
  setSourceMode: (mode: State['sourceMode']) => void
  setExecution: (mode: State['executionMode'], skillVersionId?: string | null) => void
  setConfig: (patch: Partial<State['config']>) => void
  setScenes: (scenes: ArticleIllustrationScene[]) => void
  addScene: () => void
  removeScene: (id: string) => void
  moveScene: (id: string, direction: -1 | 1) => void
  updateScene: (id: string, patch: Partial<ArticleIllustrationScene>) => void
  loadEligibleSkills: () => Promise<void>
  createPlan: () => Promise<void>
  confirm: () => Promise<void>
  refreshJob: () => Promise<void>
  retryScene: (id: string) => Promise<void>
  loadRecoverable: () => Promise<void>
  openJob: (job: ArticleIllustrationJob) => void
  resumeJob: (id: string) => Promise<void>
}
const initial = (): State => ({ mode: 'single', source: { text: '', url: '', urlConsent: false }, sourceMode: 'text', executionMode: 'fallback', selectedSkillVersionId: null, config: { imageCount: 3, model: '', aspectRatioId: '4:3', styleId: 'watercolor' }, eligibleSkills: [], scenes: [], activeJob: null, recoverableJobs: [], loading: false, error: null })

export const useArticleIllustrationStore = create<State & Actions>((set, get) => ({
  ...initial(),
  reset: () => set(initial()),
  setMode: (mode) => set({ mode }),
  setSource: (patch) => set((state) => ({ source: { ...state.source, ...patch } })),
  setSourceMode: (sourceMode) => set({ sourceMode }),
  setExecution: (executionMode, selectedSkillVersionId) => set((state) => ({ executionMode, selectedSkillVersionId: selectedSkillVersionId === undefined ? state.selectedSkillVersionId : selectedSkillVersionId })),
  setConfig: (patch) => set((state) => ({ config: { ...state.config, ...patch } })),
  setScenes: (scenes) => set({ scenes: normalizeOrdinals(scenes) }),
  addScene: () => set((state) => ({ scenes: [...state.scenes, { id: `draft-${Date.now()}`, ordinal: state.scenes.length + 1, title: '新场景', excerpt: '', prompt: '请描述文章配图场景', status: 'planned', generation_id: null, error_message: null, retry_count: 0 }] })),
  removeScene: (id) => set((state) => ({ scenes: normalizeOrdinals(state.scenes.filter((scene) => scene.id !== id)) })),
  moveScene: (id, direction) => set((state) => {
    const index = state.scenes.findIndex((scene) => scene.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= state.scenes.length) return state
    const scenes = [...state.scenes]
    ;[scenes[index], scenes[target]] = [scenes[target], scenes[index]]
    return { scenes: normalizeOrdinals(scenes) }
  }),
  updateScene: (id, patch) => set((state) => ({ scenes: state.scenes.map((scene) => scene.id === id ? { ...scene, ...patch } : scene) })),
  loadEligibleSkills: async () => {
    try {
      const eligibleSkills = await platform.articleIllustrations.listEligibleSkills()
      set((state) => state.executionMode === 'fallback' && state.selectedSkillVersionId === null && eligibleSkills.length > 0
        ? { eligibleSkills, executionMode: 'skill', selectedSkillVersionId: eligibleSkills[0].skillVersionId }
        : { eligibleSkills })
    } catch (error) { set({ error: errorMessage(error) }) }
  },
  createPlan: async () => {
    const state = get(); set({ loading: true, error: null })
    try {
      const source = state.sourceMode === 'file'
        ? { type: 'file' as const, filePath: state.source.filePath ?? '', fileName: state.source.fileName ?? '' }
        : { type: 'text' as const, text: state.source.text }
      const job = await platform.articleIllustrations.createPlan({ source, mode: state.executionMode, skillVersionId: state.selectedSkillVersionId ?? undefined, config: state.config })
      set({ activeJob: job, scenes: job.scenes, loading: false })
    } catch (error) { set({ loading: false, error: errorMessage(error) }) }
  },
  confirm: async () => {
    const state = get(); const job = state.activeJob; if (!job) return
    set({ loading: true, error: null })
    try {
      await platform.articleIllustrations.replaceScenes(job.id, normalizeOrdinals(state.scenes).map(({ ordinal, title, excerpt, prompt }) => ({ ordinal, title, excerpt, prompt })))
      const updated = await platform.articleIllustrations.confirm(job.id)
      set({ activeJob: updated, scenes: updated.scenes, loading: false })
    } catch (error) { set({ loading: false, error: errorMessage(error) }) }
  },
  refreshJob: async () => {
    const job = get().activeJob; if (!job) return
    try { const updated = await platform.articleIllustrations.get(job.id); set({ activeJob: updated, scenes: updated.scenes }) } catch (error) { set({ error: errorMessage(error) }) }
  },
  retryScene: async (id) => {
    const job = get().activeJob; if (!job) return
    try { const updated = await platform.articleIllustrations.retryScene(job.id, id); set({ activeJob: updated, scenes: updated.scenes }) } catch (error) { set({ error: errorMessage(error) }) }
  },
  loadRecoverable: async () => { try { set({ recoverableJobs: await platform.articleIllustrations.listRecoverable() }) } catch (error) { set({ error: errorMessage(error) }) } },
  openJob: (job) => set({ activeJob: job, scenes: job.scenes, error: null }),
  resumeJob: async (id) => {
    set({ loading: true, error: null })
    try {
      const job = await platform.articleIllustrations.resume(id)
      set({ activeJob: job, scenes: job.scenes, loading: false })
      await get().loadRecoverable()
    } catch (error) { set({ loading: false, error: errorMessage(error) }) }
  },
}))

function normalizeOrdinals(scenes: ArticleIllustrationScene[]) { return scenes.map((scene, index) => ({ ...scene, ordinal: index + 1 })) }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : '文章配图请求失败' }
