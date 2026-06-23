import { db } from '../client'
import { v4 as uuidv4 } from 'uuid'

export interface Skill {
  id: string; name: string; description: string; type: string
  source: string; params_schema: string; author: string | null
  version: string; is_public: number; is_installed: number
  install_count: number; created_at: number
}

export const skillRepo = {
  listInstalled(): Skill[] {
    return db.prepare('SELECT * FROM skills WHERE is_installed=1 ORDER BY name').all() as Skill[]
  },
  listMarket(query?: string, limit = 20, offset = 0): Skill[] {
    if (query) {
      const q = `%${query}%`
      return db.prepare('SELECT * FROM skills WHERE (name LIKE ? OR description LIKE ?) ORDER BY install_count DESC LIMIT ? OFFSET ?')
        .all(q, q, limit, offset) as Skill[]
    }
    return db.prepare('SELECT * FROM skills ORDER BY install_count DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as Skill[]
  },
  get(id: string): Skill | undefined {
    return db.prepare('SELECT * FROM skills WHERE id=?').get(id) as Skill | undefined
  },
  create(data: Partial<Skill> & { name: string; description: string; type: string; source: string }): Skill {
    const id = uuidv4(); const now = Date.now()
    db.prepare(`INSERT INTO skills(id,name,description,type,source,params_schema,author,version,is_public,is_installed,install_count,created_at)
      VALUES(?,?,?,?,?,?,?,?,0,1,0,?)`)
      .run(id, data.name, data.description, data.type, data.source,
           data.params_schema || '{}', data.author || 'custom', data.version || '1.0.0', now)
    return this.get(id)!
  },
  update(id: string, data: Partial<Skill>): Skill | undefined {
    const fields: string[] = []; const values: any[] = []
    if (data.name !== undefined) { fields.push('name=?'); values.push(data.name) }
    if (data.description !== undefined) { fields.push('description=?'); values.push(data.description) }
    if (data.source !== undefined) { fields.push('source=?'); values.push(data.source) }
    if (data.params_schema !== undefined) { fields.push('params_schema=?'); values.push(data.params_schema) }
    if (!fields.length) return this.get(id)
    values.push(id)
    db.prepare(`UPDATE skills SET ${fields.join(',')} WHERE id=?`).run(...values)
    return this.get(id)
  },
  install(id: string): void {
    db.prepare('UPDATE skills SET is_installed=1 WHERE id=?').run(id)
    db.prepare('UPDATE skills SET install_count=install_count+1 WHERE id=?').run(id)
  },
  uninstall(id: string): void {
    db.prepare('UPDATE skills SET is_installed=0 WHERE id=?').run(id)
  },
  delete(id: string): void {
    db.prepare('DELETE FROM skills WHERE id=?').run(id)
  },
  startRun(skillId: string, input: object): { id: string } {
    const id = uuidv4(); const now = Date.now()
    db.prepare('INSERT INTO skill_runs(id,skill_id,input_json,status,created_at) VALUES(?,?,?,?,?)')
      .run(id, skillId, JSON.stringify(input), 'running', now)
    return { id }
  },
  completeRun(id: string, output: object, durationMs: number): void {
    db.prepare('UPDATE skill_runs SET output_json=?,status=?,duration_ms=? WHERE id=?')
      .run(JSON.stringify(output), 'success', durationMs, id)
  },
  failRun(id: string, error: string, durationMs: number): void {
    db.prepare('UPDATE skill_runs SET output_json=?,status=?,duration_ms=? WHERE id=?')
      .run(JSON.stringify({ error }), 'error', durationMs, id)
  },
  listRuns(skillId: string, limit = 20): any[] {
    return db.prepare('SELECT * FROM skill_runs WHERE skill_id=? ORDER BY created_at DESC LIMIT ?')
      .all(skillId, limit) as any[]
  }
}
