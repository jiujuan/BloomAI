import { desc, eq, like, or, sql, asc } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getOrmDb } from '../client'
import { skill_runs, skills } from '../schema'

export interface Skill {
  id: string; name: string; description: string; type: string
  source: string; params_schema: string; author: string | null
  version: string; is_public: number; is_installed: number
  install_count: number; created_at: number
}


export const skillRepo = {
  listInstalled(): Skill[] {
    return getOrmDb().select().from(skills).where(eq(skills.is_installed, 1)).orderBy(asc(skills.name)).all() as Skill[]
  },

  listMarket(query?: string, limit = 20, offset = 0): Skill[] {
    if (query) {
      const q = `%${query}%`
      return getOrmDb().select().from(skills)
        .where(or(like(skills.name, q), like(skills.description, q)))
        .orderBy(desc(skills.install_count))
        .limit(limit)
        .offset(offset)
        .all() as Skill[]
    }
    return getOrmDb().select().from(skills).orderBy(desc(skills.install_count)).limit(limit).offset(offset).all() as Skill[]
  },

  get(id: string): Skill | undefined {
    return getOrmDb().select().from(skills).where(eq(skills.id, id)).get() as Skill | undefined
  },

  create(data: Partial<Skill> & { name: string; description: string; type: string; source: string }): Skill {
    const id = uuidv4()
    const now = Date.now()
    getOrmDb().insert(skills).values({
      id,
      name: data.name,
      description: data.description,
      type: data.type,
      source: data.source,
      params_schema: data.params_schema || '{}',
      author: data.author || 'custom',
      version: data.version || '1.0.0',
      is_public: 0,
      is_installed: 1,
      install_count: 0,
      created_at: now,
    }).run()
    return this.get(id)!
  },

  update(id: string, data: Partial<Skill>): Skill | undefined {
    const updates: Partial<typeof skills.$inferInsert> = {}
    if (data.name !== undefined) updates.name = data.name
    if (data.description !== undefined) updates.description = data.description
    if (data.source !== undefined) updates.source = data.source
    if (data.params_schema !== undefined) updates.params_schema = data.params_schema
    if (!Object.keys(updates).length) return this.get(id)
    getOrmDb().update(skills).set(updates).where(eq(skills.id, id)).run()
    return this.get(id)
  },

  install(id: string): void {
    getOrmDb().update(skills).set({
      is_installed: 1,
      install_count: sql`${skills.install_count} + 1`,
    }).where(eq(skills.id, id)).run()
  },

  uninstall(id: string): void {
    getOrmDb().update(skills).set({ is_installed: 0 }).where(eq(skills.id, id)).run()
  },

  delete(id: string): void {
    getOrmDb().delete(skills).where(eq(skills.id, id)).run()
  },

  startRun(skillId: string, input: object): { id: string } {
    const id = uuidv4()
    const now = Date.now()
    getOrmDb().insert(skill_runs).values({ id, skill_id: skillId, input_json: JSON.stringify(input), status: 'running', created_at: now }).run()
    return { id }
  },

  completeRun(id: string, output: object, durationMs: number): void {
    getOrmDb().update(skill_runs).set({ output_json: JSON.stringify(output), status: 'success', duration_ms: durationMs }).where(eq(skill_runs.id, id)).run()
  },

  failRun(id: string, error: string, durationMs: number): void {
    getOrmDb().update(skill_runs).set({ output_json: JSON.stringify({ error }), status: 'error', duration_ms: durationMs }).where(eq(skill_runs.id, id)).run()
  },

  listRuns(skillId: string, limit = 20): any[] {
    return getOrmDb().select().from(skill_runs).where(eq(skill_runs.skill_id, skillId)).orderBy(desc(skill_runs.created_at)).limit(limit).all()
  },
}
