import { db } from '../client'
import { v4 as uuidv4 } from 'uuid'

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
      return db.prepare('SELECT * FROM tools WHERE category=? ORDER BY name').all(category) as Tool[]
    }
    return db.prepare('SELECT * FROM tools ORDER BY category, name').all() as Tool[]
  },
  get(id: string): Tool | undefined {
    return db.prepare('SELECT * FROM tools WHERE id=?').get(id) as Tool | undefined
  },
  setEnabled(id: string, enabled: boolean): void {
    db.prepare('UPDATE tools SET is_enabled=? WHERE id=?').run(enabled ? 1 : 0, id)
  },
  startRun(toolId: string, sessionId: string | null, input: object): ToolRun {
    const id = uuidv4(); const now = Date.now()
    db.prepare('INSERT INTO tool_runs(id,tool_id,session_id,input_json,status,started_at) VALUES(?,?,?,?,?,?)')
      .run(id, toolId, sessionId, JSON.stringify(input), 'running', now)
    return db.prepare('SELECT * FROM tool_runs WHERE id=?').get(id) as ToolRun
  },
  completeRun(id: string, output: object): void {
    const now = Date.now()
    const run = db.prepare('SELECT started_at FROM tool_runs WHERE id=?').get(id) as any
    const duration = run ? now - run.started_at : 0
    db.prepare('UPDATE tool_runs SET output_json=?,status=?,finished_at=?,duration_ms=? WHERE id=?')
      .run(JSON.stringify(output), 'success', now, duration, id)
  },
  failRun(id: string, error: string): void {
    const now = Date.now()
    const run = db.prepare('SELECT started_at FROM tool_runs WHERE id=?').get(id) as any
    const duration = run ? now - run.started_at : 0
    db.prepare('UPDATE tool_runs SET error_msg=?,status=?,finished_at=?,duration_ms=? WHERE id=?')
      .run(error, 'error', now, duration, id)
  },
  listRuns(toolId: string, limit = 50): ToolRun[] {
    return db.prepare('SELECT * FROM tool_runs WHERE tool_id=? ORDER BY started_at DESC LIMIT ?')
      .all(toolId, limit) as ToolRun[]
  },
  listAllRuns(limit = 100): any[] {
    return db.prepare(`SELECT tr.*, t.name as tool_name, t.category FROM tool_runs tr
      LEFT JOIN tools t ON tr.tool_id=t.id ORDER BY tr.started_at DESC LIMIT ?`)
      .all(limit) as any[]
  },
  getStats(): object {
    const total = (db.prepare('SELECT COUNT(*) as c FROM tools').get() as any)?.c || 0
    const enabled = (db.prepare('SELECT COUNT(*) as c FROM tools WHERE is_enabled=1').get() as any)?.c || 0
    const todayStart = new Date(); todayStart.setHours(0,0,0,0)
    const todayCalls = (db.prepare('SELECT COUNT(*) as c FROM tool_runs WHERE started_at >= ?').get(todayStart.getTime()) as any)?.c || 0
    const errors = (db.prepare("SELECT COUNT(*) as c FROM tool_runs WHERE status='error'").get() as any)?.c || 0
    const avgDur = (db.prepare("SELECT AVG(duration_ms) as a FROM tool_runs WHERE status='success' AND duration_ms IS NOT NULL").get() as any)?.a || 0
    return { total, enabled, todayCalls, errors, avgDurationMs: Math.round(avgDur) }
  },
  getPermission(toolId: string): ToolPermission | undefined {
    return db.prepare('SELECT * FROM tool_permissions WHERE tool_id=?').get(toolId) as ToolPermission | undefined
  },
  grantPermission(toolId: string, scope: string): void {
    const id = uuidv4(); const now = Date.now()
    db.prepare('INSERT OR REPLACE INTO tool_permissions(id,tool_id,granted,granted_at,scope) VALUES(?,?,1,?,?)')
      .run(id, toolId, now, scope)
  },
  revokePermission(toolId: string): void {
    db.prepare("UPDATE tool_permissions SET granted=0 WHERE tool_id=?").run(toolId)
  },
  listPermissions(): ToolPermission[] {
    return db.prepare('SELECT * FROM tool_permissions').all() as ToolPermission[]
  }
}
