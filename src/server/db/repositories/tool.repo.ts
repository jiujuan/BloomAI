import { asc, desc, eq, gte, like, or, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getOrmDb } from '../client'
import { skill_runs, skills, tool_permissions, tool_runs, tools } from '../schema'

export interface Tool {
  id: string; category: string; name: string; description: string
  params_schema: string; result_schema: string
  is_builtin: number; is_enabled: number
  requires_permission: string | null; created_at: number
}
export interface ToolRun {
  id: string; tool_id: string; session_id: string | null
  input_json: string; output_json: string | null; status: string
  error_msg: string | null; duration_ms: number | null
  started_at: number; finished_at: number | null
}
export interface ToolPermission {
  id: string; tool_id: string; granted: number
  granted_at: number | null; scope: string
}


export const toolRepo = {
  list(category?: string): Tool[] {
    if (category && category !== 'all') {
      return getOrmDb().select().from(tools).where(eq(tools.category, category)).orderBy(asc(tools.name)).all() as Tool[]
    }
    return getOrmDb().select().from(tools).orderBy(asc(tools.category), asc(tools.name)).all() as Tool[]
  },

  get(id: string): Tool | undefined {
    return getOrmDb().select().from(tools).where(eq(tools.id, id)).get() as Tool | undefined
  },

  setEnabled(id: string, enabled: boolean): void {
    getOrmDb().update(tools).set({ is_enabled: enabled ? 1 : 0 }).where(eq(tools.id, id)).run()
  },

  startRun(toolId: string, sessionId: string | null, input: object): ToolRun {
    const id = uuidv4()
    const now = Date.now()
    getOrmDb().insert(tool_runs).values({
      id,
      tool_id: toolId,
      session_id: sessionId,
      input_json: JSON.stringify(input),
      status: 'running',
      started_at: now,
    }).run()
    return getOrmDb().select().from(tool_runs).where(eq(tool_runs.id, id)).get() as ToolRun
  },

  completeRun(id: string, output: object): void {
    const now = Date.now()
    const run = getOrmDb().select({ started_at: tool_runs.started_at }).from(tool_runs).where(eq(tool_runs.id, id)).get()
    getOrmDb().update(tool_runs).set({
      output_json: JSON.stringify(output),
      status: 'success',
      finished_at: now,
      duration_ms: run ? now - run.started_at : 0,
    }).where(eq(tool_runs.id, id)).run()
  },

  failRun(id: string, error: string): void {
    const now = Date.now()
    const run = getOrmDb().select({ started_at: tool_runs.started_at }).from(tool_runs).where(eq(tool_runs.id, id)).get()
    getOrmDb().update(tool_runs).set({
      error_msg: error,
      status: 'error',
      finished_at: now,
      duration_ms: run ? now - run.started_at : 0,
    }).where(eq(tool_runs.id, id)).run()
  },

  listRuns(toolId: string, limit = 50): ToolRun[] {
    return getOrmDb().select().from(tool_runs).where(eq(tool_runs.tool_id, toolId)).orderBy(desc(tool_runs.started_at)).limit(limit).all() as ToolRun[]
  },

  listAllRuns(limit = 100): any[] {
    return getOrmDb().select({
      id: tool_runs.id,
      tool_id: tool_runs.tool_id,
      session_id: tool_runs.session_id,
      input_json: tool_runs.input_json,
      output_json: tool_runs.output_json,
      status: tool_runs.status,
      error_msg: tool_runs.error_msg,
      duration_ms: tool_runs.duration_ms,
      started_at: tool_runs.started_at,
      finished_at: tool_runs.finished_at,
      tool_name: tools.name,
      category: tools.category,
    }).from(tool_runs).leftJoin(tools, eq(tool_runs.tool_id, tools.id)).orderBy(desc(tool_runs.started_at)).limit(limit).all()
  },

  getStats(): object {
    const total = Number(getOrmDb().select({ c: sql<number>`count(*)` }).from(tools).get()?.c || 0)
    const enabled = Number(getOrmDb().select({ c: sql<number>`count(*)` }).from(tools).where(eq(tools.is_enabled, 1)).get()?.c || 0)
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayCalls = Number(getOrmDb().select({ c: sql<number>`count(*)` }).from(tool_runs).where(gte(tool_runs.started_at, todayStart.getTime())).get()?.c || 0)
    const errors = Number(getOrmDb().select({ c: sql<number>`count(*)` }).from(tool_runs).where(eq(tool_runs.status, 'error')).get()?.c || 0)
    const avgDur = Number(getOrmDb().select({ a: sql<number>`avg(${tool_runs.duration_ms})` }).from(tool_runs).where(sql`${tool_runs.status} = 'success' AND ${tool_runs.duration_ms} IS NOT NULL`).get()?.a || 0)
    return { total, enabled, todayCalls, errors, avgDurationMs: Math.round(avgDur) }
  },

  getPermission(toolId: string): ToolPermission | undefined {
    return getOrmDb().select().from(tool_permissions).where(eq(tool_permissions.tool_id, toolId)).get() as ToolPermission | undefined
  },

  grantPermission(toolId: string, scope: string): void {
    const id = uuidv4()
    const now = Date.now()
    const existing = this.getPermission(toolId)
    if (existing) {
      getOrmDb().update(tool_permissions).set({ id, granted: 1, granted_at: now, scope }).where(eq(tool_permissions.tool_id, toolId)).run()
      return
    }
    getOrmDb().insert(tool_permissions).values({ id, tool_id: toolId, granted: 1, granted_at: now, scope }).run()
  },

  revokePermission(toolId: string): void {
    getOrmDb().update(tool_permissions).set({ granted: 0 }).where(eq(tool_permissions.tool_id, toolId)).run()
  },

  listPermissions(): ToolPermission[] {
    return getOrmDb().select().from(tool_permissions).all() as ToolPermission[]
  },
}

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
