import { db } from '../client'
import { v4 as uuidv4 } from 'uuid'

export interface Session {
  id: string; title: string; persona_id: string | null
  model: string; status: string; created_at: number; updated_at: number
}

export const sessionRepo = {
  list(): Session[] {
    return db.prepare("SELECT * FROM sessions WHERE status = 'active' ORDER BY updated_at DESC").all() as Session[]
  },
  get(id: string): Session | undefined {
    return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | undefined
  },
  create(data: { title?: string; persona_id?: string; model?: string }): Session {
    const id = uuidv4(); const now = Date.now()
    const s = db.prepare("SELECT value FROM settings WHERE key = 'model'").get() as any
    const model = data.model || s?.value || 'claude-3-5-sonnet-20241022'
    db.prepare("INSERT INTO sessions (id,title,persona_id,model,status,created_at,updated_at) VALUES (?,?,?,?,'active',?,?)")
      .run(id, data.title || 'New Chat', data.persona_id || null, model, now, now)
    return this.get(id)!
  },
  update(id: string, data: Partial<Pick<Session,'title'|'persona_id'|'model'>>): Session | undefined {
    const fields: string[] = []; const values: any[] = []
    if (data.title !== undefined) { fields.push('title=?'); values.push(data.title) }
    if (data.persona_id !== undefined) { fields.push('persona_id=?'); values.push(data.persona_id) }
    if (data.model !== undefined) { fields.push('model=?'); values.push(data.model) }
    if (!fields.length) return this.get(id)
    values.push(Date.now(), id)
    db.prepare(`UPDATE sessions SET ${fields.join(',')},updated_at=? WHERE id=?`).run(...values)
    return this.get(id)
  },
  delete(id: string): void {
    db.prepare("UPDATE sessions SET status='archived' WHERE id=?").run(id)
  },
  touch(id: string): void {
    db.prepare('UPDATE sessions SET updated_at=? WHERE id=?').run(Date.now(), id)
  }
}
