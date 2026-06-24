import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getOrmDb } from '../client'
import { messages } from '../schema'

export interface Message {
  id: string; session_id: string; role: string
  content: string; tool_calls?: string | null; tokens?: number | null; created_at: number
}


export const messageRepo = {
  list(sessionId: string, limit = 100, offset = 0): Message[] {
    return getOrmDb().select().from(messages)
      .where(eq(messages.session_id, sessionId))
      .orderBy(asc(messages.created_at))
      .limit(limit)
      .offset(offset)
      .all() as Message[]
  },

  getHistory(sessionId: string, last = 20): Array<{ role: string; content: string }> {
    const rows = getOrmDb().select({ role: messages.role, content: messages.content }).from(messages)
      .where(and(eq(messages.session_id, sessionId), inArray(messages.role, ['user', 'assistant'])))
      .orderBy(desc(messages.created_at))
      .limit(last)
      .all() as Array<{ role: string; content: string }>
    return rows.reverse()
  },

  save(data: Omit<Message, 'id' | 'created_at'>): Message {
    const id = uuidv4()
    const now = Date.now()
    getOrmDb().insert(messages).values({
      id,
      session_id: data.session_id,
      role: data.role,
      content: data.content,
      tool_calls: data.tool_calls || null,
      tokens: data.tokens || null,
      created_at: now,
    }).run()
    return getOrmDb().select().from(messages).where(eq(messages.id, id)).get() as Message
  },

  count(sessionId: string): number {
    const row = getOrmDb().select({ c: sql<number>`count(*)` }).from(messages).where(eq(messages.session_id, sessionId)).get()
    return Number(row?.c || 0)
  },
}
