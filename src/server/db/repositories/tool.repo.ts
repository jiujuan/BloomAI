import { asc, desc, eq, gte, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getOrmDb } from '../client'
import { tool_permissions, tool_runs, tools } from '../schema'

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
