import { and, desc, eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getOrmDb } from '../client'
import { projects, sessions, type ProjectRow } from '../schema'
import type { ProjectSummary } from '../../../shared/schemas'
import type { Session } from './session.repo'

export type Project = ProjectRow

export interface ProjectPageInput { limit: number; offset: number }
export interface CreateProjectRecord { id?: string; name: string; root_path: string; directory_kind: 'auto' | 'selected' }
export interface CreateProjectSessionInput { title?: string; persona_id?: string; model?: string }

function toSummary(row: Project & { sessionCount: number | string }): ProjectSummary {
  return { ...row, sessionCount: Number(row.sessionCount) }
}

export const projectRepo = {
  get(id: string): Project | undefined {
    return getOrmDb().select().from(projects).where(eq(projects.id, id)).get() as Project | undefined
  },

  getByRootPath(rootPath: string): Project | undefined {
    return getOrmDb().select().from(projects).where(sql`${projects.root_path} = ${rootPath} COLLATE NOCASE`).get() as Project | undefined
  },

  listSummaries(): ProjectSummary[] {
    return getOrmDb().select({
      id: projects.id, name: projects.name, root_path: projects.root_path, directory_kind: projects.directory_kind,
      created_at: projects.created_at, updated_at: projects.updated_at, sessionCount: sql<number>`count(${sessions.id})`,
    }).from(projects).leftJoin(sessions, and(eq(sessions.project_id, projects.id), eq(sessions.status, 'active'))).groupBy(projects.id)
      .orderBy(desc(projects.updated_at)).all().map(toSummary)
  },

  create(input: CreateProjectRecord): Project {
    const id = input.id ?? uuidv4()
    const now = Date.now()
    getOrmDb().insert(projects).values({ id, name: input.name, root_path: input.root_path, directory_kind: input.directory_kind, created_at: now, updated_at: now }).run()
    return this.get(id)!
  },

  updateTimestamp(id: string): void {
    getOrmDb().update(projects).set({ updated_at: Date.now() }).where(eq(projects.id, id)).run()
  },

  countProjectSessions(projectId: string): number {
    return Number(getOrmDb().select({ count: sql<number>`count(*)` }).from(sessions)
      .where(and(eq(sessions.project_id, projectId), eq(sessions.status, 'active'))).get()?.count ?? 0)
  },

  listProjectSessions(projectId: string, { limit, offset }: ProjectPageInput): Session[] {
    return getOrmDb().select().from(sessions).where(and(eq(sessions.project_id, projectId), eq(sessions.status, 'active')))
      .orderBy(desc(sessions.updated_at)).limit(limit).offset(offset).all() as Session[]
  },

  createProjectSession(projectId: string, input: CreateProjectSessionInput = {}): Session {
    const id = uuidv4(); const now = Date.now()
    getOrmDb().insert(sessions).values({ id, title: input.title ?? 'New Chat', persona_id: input.persona_id ?? null,
      model: input.model ?? 'claude-3-5-sonnet-20241022', status: 'active', project_id: projectId, created_at: now, updated_at: now }).run()
    return getOrmDb().select().from(sessions).where(eq(sessions.id, id)).get() as Session
  },

  createWithInitialSession(input: CreateProjectRecord): { project: Project; initialSession: Session } {
    const id = input.id ?? uuidv4(); const now = Date.now(); const sessionId = uuidv4()
    return getOrmDb().transaction((tx) => {
      tx.insert(projects).values({ id, name: input.name, root_path: input.root_path, directory_kind: input.directory_kind, created_at: now, updated_at: now }).run()
      tx.insert(sessions).values({ id: sessionId, title: 'New Chat', persona_id: null, model: 'claude-3-5-sonnet-20241022', status: 'active', project_id: id, created_at: now, updated_at: now }).run()
      return {
        project: tx.select().from(projects).where(eq(projects.id, id)).get() as Project,
        initialSession: tx.select().from(sessions).where(eq(sessions.id, sessionId)).get() as Session,
      }
    })
  },
}
