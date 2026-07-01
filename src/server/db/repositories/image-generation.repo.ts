import { asc, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getOrmDb } from '../client'
import { image_generations } from '../schema'

export interface ImageGeneration {
  id: string
  session_id: string
  message_id: string | null
  prompt: string
  resolved_prompt: string | null
  provider_id: string
  model: string
  aspect_ratio: string | null
  style: string | null
  size: string | null
  seed: number | null
  reference_images: string | null
  status: string
  provider_task_id: string | null
  progress: number | null
  url: string | null
  local_path: string | null
  error_msg: string | null
  duration_ms: number | null
  created_at: number
  updated_at: number
}

export type NewImageGeneration = Omit<ImageGeneration, 'id' | 'created_at' | 'updated_at'>

export const imageGenerationRepo = {
  listBySession(sessionId: string): ImageGeneration[] {
    return getOrmDb().select().from(image_generations)
      .where(eq(image_generations.session_id, sessionId))
      .orderBy(asc(image_generations.created_at))
      .all() as ImageGeneration[]
  },

  get(id: string): ImageGeneration | undefined {
    return getOrmDb().select().from(image_generations).where(eq(image_generations.id, id)).get() as ImageGeneration | undefined
  },

  create(data: Partial<NewImageGeneration> & Pick<ImageGeneration, 'session_id' | 'prompt' | 'provider_id' | 'model' | 'status'>): ImageGeneration {
    const id = uuidv4()
    const now = Date.now()
    getOrmDb().insert(image_generations).values({
      id,
      session_id: data.session_id,
      message_id: data.message_id ?? null,
      prompt: data.prompt,
      resolved_prompt: data.resolved_prompt ?? null,
      provider_id: data.provider_id,
      model: data.model,
      aspect_ratio: data.aspect_ratio ?? null,
      style: data.style ?? null,
      size: data.size ?? null,
      seed: data.seed ?? null,
      reference_images: data.reference_images ?? null,
      status: data.status,
      provider_task_id: data.provider_task_id ?? null,
      progress: data.progress ?? null,
      url: data.url ?? null,
      local_path: data.local_path ?? null,
      error_msg: data.error_msg ?? null,
      duration_ms: data.duration_ms ?? null,
      created_at: now,
      updated_at: now,
    }).run()
    return this.get(id)!
  },

  update(id: string, data: Partial<NewImageGeneration>): ImageGeneration | undefined {
    getOrmDb().update(image_generations).set({ ...data, updated_at: Date.now() }).where(eq(image_generations.id, id)).run()
    return this.get(id)
  },
}
