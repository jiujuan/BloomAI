import { asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getOrmDb } from '../client'
import { article_illustration_jobs, article_illustration_scenes } from '../schema'

export type ArticleIllustrationMode = 'skill' | 'fallback'
export type ArticleIllustrationSourceType = 'text' | 'url' | 'file'

export interface ArticleIllustrationJob {
  id: string
  source_type: ArticleIllustrationSourceType
  source_label: string
  source_url: string | null
  article_text: string
  mode: ArticleIllustrationMode
  skill_version_id: string | null
  run_id: string | null
  image_session_id: string | null
  config: Record<string, unknown>
  status: string
  error_message: string | null
  created_at: number
  updated_at: number
}

export interface ArticleIllustrationScene {
  id: string
  job_id: string
  ordinal: number
  title: string
  excerpt: string
  prompt: string
  status: string
  generation_id: string | null
  error_message: string | null
  retry_count: number
  created_at: number
  updated_at: number
}

type NewJob = {
  sourceType: ArticleIllustrationSourceType
  sourceLabel: string
  sourceUrl?: string | null
  articleText: string
  mode: ArticleIllustrationMode
  skillVersionId?: string | null
  runId?: string | null
  imageSessionId?: string | null
  config: Record<string, unknown>
  status?: string
  errorMessage?: string | null
}
type NewScene = Pick<ArticleIllustrationScene, 'ordinal' | 'title' | 'excerpt' | 'prompt'> & Partial<Pick<ArticleIllustrationScene, 'status' | 'generation_id' | 'error_message' | 'retry_count'>>

function decodeJob(row: typeof article_illustration_jobs.$inferSelect): ArticleIllustrationJob {
  let config: Record<string, unknown> = {}
  try { config = JSON.parse(row.config_json) } catch { /* corrupted data remains safely readable */ }
  return { ...row, source_type: row.source_type as ArticleIllustrationSourceType, mode: row.mode as ArticleIllustrationMode, config }
}

export const articleIllustrationRepo = {
  createJob(data: NewJob): ArticleIllustrationJob {
    const id = uuidv4()
    const now = Date.now()
    getOrmDb().insert(article_illustration_jobs).values({
      id, source_type: data.sourceType, source_label: data.sourceLabel, source_url: data.sourceUrl ?? null,
      article_text: data.articleText, mode: data.mode, skill_version_id: data.skillVersionId ?? null,
      run_id: data.runId ?? null, image_session_id: data.imageSessionId ?? null,
      config_json: JSON.stringify(data.config), status: data.status ?? 'waiting_approval',
      error_message: data.errorMessage ?? null, created_at: now, updated_at: now,
    }).run()
    return this.getJob(id)!
  },

  getJob(id: string): ArticleIllustrationJob | undefined {
    const row = getOrmDb().select().from(article_illustration_jobs).where(eq(article_illustration_jobs.id, id)).get()
    return row ? decodeJob(row) : undefined
  },

  listRecoverable(): ArticleIllustrationJob[] {
    const rows = getOrmDb().select().from(article_illustration_jobs)
      .where(inArray(article_illustration_jobs.status, ['waiting_approval', 'waiting_input', 'running', 'interrupted', 'failed']))
      .orderBy(desc(article_illustration_jobs.updated_at)).all()
    return rows.map(decodeJob)
  },

  updateJob(id: string, data: Partial<Omit<NewJob, 'sourceType' | 'sourceLabel' | 'articleText' | 'mode'>> & {
    sourceType?: ArticleIllustrationSourceType; sourceLabel?: string; articleText?: string; mode?: ArticleIllustrationMode
  }): ArticleIllustrationJob | undefined {
    const updates: Partial<typeof article_illustration_jobs.$inferInsert> = { updated_at: Date.now() }
    if (data.sourceType !== undefined) updates.source_type = data.sourceType
    if (data.sourceLabel !== undefined) updates.source_label = data.sourceLabel
    if (data.sourceUrl !== undefined) updates.source_url = data.sourceUrl
    if (data.articleText !== undefined) updates.article_text = data.articleText
    if (data.mode !== undefined) updates.mode = data.mode
    if (data.skillVersionId !== undefined) updates.skill_version_id = data.skillVersionId
    if (data.runId !== undefined) updates.run_id = data.runId
    if (data.imageSessionId !== undefined) updates.image_session_id = data.imageSessionId
    if (data.config !== undefined) updates.config_json = JSON.stringify(data.config)
    if (data.status !== undefined) updates.status = data.status
    if (data.errorMessage !== undefined) updates.error_message = data.errorMessage
    getOrmDb().update(article_illustration_jobs).set(updates).where(eq(article_illustration_jobs.id, id)).run()
    return this.getJob(id)
  },

  replaceScenes(jobId: string, scenes: NewScene[]): ArticleIllustrationScene[] {
    return getOrmDb().transaction((tx) => {
      tx.delete(article_illustration_scenes).where(eq(article_illustration_scenes.job_id, jobId)).run()
      const now = Date.now()
      for (const scene of scenes) {
        tx.insert(article_illustration_scenes).values({
          id: uuidv4(), job_id: jobId, ordinal: scene.ordinal, title: scene.title, excerpt: scene.excerpt,
          prompt: scene.prompt, status: scene.status ?? 'planned', generation_id: scene.generation_id ?? null,
          error_message: scene.error_message ?? null, retry_count: scene.retry_count ?? 0, created_at: now, updated_at: now,
        }).run()
      }
      tx.update(article_illustration_jobs).set({ updated_at: now }).where(eq(article_illustration_jobs.id, jobId)).run()
      return tx.select().from(article_illustration_scenes).where(eq(article_illustration_scenes.job_id, jobId)).orderBy(asc(article_illustration_scenes.ordinal)).all()
    }) as ArticleIllustrationScene[]
  },

  listScenes(jobId: string): ArticleIllustrationScene[] {
    return getOrmDb().select().from(article_illustration_scenes).where(eq(article_illustration_scenes.job_id, jobId))
      .orderBy(asc(article_illustration_scenes.ordinal)).all() as ArticleIllustrationScene[]
  },

  updateScene(jobId: string, sceneId: string, data: Partial<Pick<ArticleIllustrationScene, 'ordinal' | 'title' | 'excerpt' | 'prompt' | 'status' | 'generation_id' | 'error_message'>>): ArticleIllustrationScene | undefined {
    getOrmDb().update(article_illustration_scenes).set({ ...data, updated_at: Date.now() })
      .where(sql`${article_illustration_scenes.id} = ${sceneId} AND ${article_illustration_scenes.job_id} = ${jobId}`).run()
    return this.listScenes(jobId).find((scene) => scene.id === sceneId)
  },

  incrementSceneRetry(jobId: string, sceneId: string): ArticleIllustrationScene | undefined {
    getOrmDb().update(article_illustration_scenes).set({ retry_count: sql`${article_illustration_scenes.retry_count} + 1`, updated_at: Date.now() })
      .where(sql`${article_illustration_scenes.id} = ${sceneId} AND ${article_illustration_scenes.job_id} = ${jobId}`).run()
    return this.listScenes(jobId).find((scene) => scene.id === sceneId)
  },
}