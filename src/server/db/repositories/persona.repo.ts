import { db } from '../client'
import { v4 as uuidv4 } from 'uuid'

export interface Persona {
  id: string; name: string; system_prompt: string
  model_override: string|null; is_builtin: number; created_at: number
}

export const personaRepo = {
  list(): Persona[] {
    return db.prepare('SELECT * FROM personas ORDER BY is_builtin DESC, created_at ASC').all() as Persona[]
  },
  get(id: string): Persona|undefined {
    return db.prepare('SELECT * FROM personas WHERE id=?').get(id) as Persona|undefined
  },
  create(data: Pick<Persona,'name'|'system_prompt'|'model_override'>): Persona {
    const id = uuidv4(); const now = Date.now()
    db.prepare('INSERT INTO personas (id,name,system_prompt,model_override,is_builtin,created_at) VALUES (?,?,?,?,0,?)')
      .run(id, data.name, data.system_prompt, data.model_override||null, now)
    return this.get(id)!
  },
  update(id: string, data: Partial<Pick<Persona,'name'|'system_prompt'|'model_override'>>): Persona|undefined {
    const p = this.get(id)
    if (!p || p.is_builtin) return p
    const fields: string[] = []; const values: any[] = []
    if (data.name!==undefined){fields.push('name=?');values.push(data.name)}
    if (data.system_prompt!==undefined){fields.push('system_prompt=?');values.push(data.system_prompt)}
    if (data.model_override!==undefined){fields.push('model_override=?');values.push(data.model_override)}
    if (!fields.length) return p
    values.push(id)
    db.prepare(`UPDATE personas SET ${fields.join(',')} WHERE id=?`).run(...values)
    return this.get(id)
  },
  delete(id: string): boolean {
    const p = this.get(id)
    if (!p||p.is_builtin) return false
    db.prepare('DELETE FROM personas WHERE id=?').run(id)
    return true
  }
}
