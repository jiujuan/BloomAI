import { desc, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getOrmDb } from '../client'
import { image_sessions } from '../schema'
import { settingsRepo } from './settings.repo'

export interface ImageSession {
  id: string
  title: string
  default_model: string | null
  status: string
  created_at: number
  updated_at: number
}

export const imageSessionRepo = {
  list(): ImageSession[] {
    return getOrmDb().select().from(image_sessions)
      .where(eq(image_sessions.status, 'active'))
      .orderBy(desc(image_sessions.updated_at))
      .all() as ImageSession[]
  },

  get(id: string): ImageSession | undefined {
    return getOrmDb().select().from(image_sessions).where(eq(image_sessions.id, id)).get() as ImageSession | undefined
  },

  create(data: { title?: string; default_model?: string } = {}): ImageSession {
    const id = uuidv4()
    const now = Date.now()
    const defaultModel = data.default_model || settingsRepo.getValue('default_image_model') || 'agnes-image-2.1-flash'
    getOrmDb().insert(image_sessions).values({
      id,
      title: data.title || '新画图',
      default_model: defaultModel,
      status: 'active',
      created_at: now,
      updated_at: now,
    }).run()
    return this.get(id)!
  },

  update(id: string, data: Partial<Pick<ImageSession, 'title' | 'default_model'>>): ImageSession | undefined {
    const updates: Partial<typeof image_sessions.$inferInsert> = { updated_at: Date.now() }
    if (data.title !== undefined) updates.title = data.title
    if (data.default_model !== undefined) updates.default_model = data.default_model
    if (Object.keys(updates).length === 1) return this.get(id)
    getOrmDb().update(image_sessions).set(updates).where(eq(image_sessions.id, id)).run()
    return this.get(id)
  },

  delete(id: string): void {
    getOrmDb().update(image_sessions).set({ status: 'archived' }).where(eq(image_sessions.id, id)).run()
  },

  touch(id: string): void {
    getOrmDb().update(image_sessions).set({ updated_at: Date.now() }).where(eq(image_sessions.id, id)).run()
  },
}
