import { desc, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getOrmDb } from '../client'
import { sessions } from '../schema'
import { settingsRepo } from './settings.repo'

export interface Session {
  id: string; title: string; persona_id: string | null
  model: string; status: string; created_at: number; updated_at: number
}


export const sessionRepo = {
  list(): Session[] {
    return getOrmDb().select().from(sessions).where(eq(sessions.status, 'active')).orderBy(desc(sessions.updated_at)).all() as Session[]
  },

  get(id: string): Session | undefined {
    return getOrmDb().select().from(sessions).where(eq(sessions.id, id)).get() as Session | undefined
  },

  create(data: { title?: string; persona_id?: string; model?: string }): Session {
    const id = uuidv4()
    const now = Date.now()
    const settingsModel = settingsRepo.getValue('model')
    const model = data.model || settingsModel || 'claude-3-5-sonnet-20241022'
    getOrmDb().insert(sessions).values({
      id,
      title: data.title || 'New Chat',
      persona_id: data.persona_id || null,
      model,
      status: 'active',
      created_at: now,
      updated_at: now,
    }).run()
    return this.get(id)!
  },

  update(id: string, data: Partial<Pick<Session, 'title' | 'persona_id' | 'model'>>): Session | undefined {
    const updates: Partial<typeof sessions.$inferInsert> = { updated_at: Date.now() }
    if (data.title !== undefined) updates.title = data.title
    if (data.persona_id !== undefined) updates.persona_id = data.persona_id
    if (data.model !== undefined) updates.model = data.model
    if (Object.keys(updates).length === 1) return this.get(id)
    getOrmDb().update(sessions).set(updates).where(eq(sessions.id, id)).run()
    return this.get(id)
  },

  delete(id: string): void {
    getOrmDb().update(sessions).set({ status: 'archived' }).where(eq(sessions.id, id)).run()
  },

  touch(id: string): void {
    getOrmDb().update(sessions).set({ updated_at: Date.now() }).where(eq(sessions.id, id)).run()
  },
}
