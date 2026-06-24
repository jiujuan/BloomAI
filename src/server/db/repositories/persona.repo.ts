import { asc, desc, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getOrmDb } from '../client'
import { personas } from '../schema'

export interface Persona {
  id: string; name: string; system_prompt: string
  model_override: string | null; is_builtin: number; created_at: number
}


export const personaRepo = {
  list(): Persona[] {
    return getOrmDb().select().from(personas).orderBy(desc(personas.is_builtin), asc(personas.created_at)).all() as Persona[]
  },

  get(id: string): Persona | undefined {
    return getOrmDb().select().from(personas).where(eq(personas.id, id)).get() as Persona | undefined
  },

  create(data: Pick<Persona, 'name' | 'system_prompt' | 'model_override'>): Persona {
    const id = uuidv4()
    const now = Date.now()
    getOrmDb().insert(personas).values({
      id,
      name: data.name,
      system_prompt: data.system_prompt,
      model_override: data.model_override || null,
      is_builtin: 0,
      created_at: now,
    }).run()
    return this.get(id)!
  },

  update(id: string, data: Partial<Pick<Persona, 'name' | 'system_prompt' | 'model_override'>>): Persona | undefined {
    const persona = this.get(id)
    if (!persona || persona.is_builtin) return persona

    const updates: Partial<typeof personas.$inferInsert> = {}
    if (data.name !== undefined) updates.name = data.name
    if (data.system_prompt !== undefined) updates.system_prompt = data.system_prompt
    if (data.model_override !== undefined) updates.model_override = data.model_override
    if (!Object.keys(updates).length) return persona

    getOrmDb().update(personas).set(updates).where(eq(personas.id, id)).run()
    return this.get(id)
  },

  delete(id: string): boolean {
    const persona = this.get(id)
    if (!persona || persona.is_builtin) return false
    getOrmDb().delete(personas).where(eq(personas.id, id)).run()
    return true
  },
}
