import { db } from '../client'
import { v4 as uuidv4 } from 'uuid'

export interface Message {
  id: string; session_id: string; role: string
  content: string; tool_calls?: string; tokens?: number; created_at: number
}

export const messageRepo = {
  list(sessionId: string, limit = 100, offset = 0): Message[] {
    return db.prepare('SELECT * FROM messages WHERE session_id=? ORDER BY created_at ASC LIMIT ? OFFSET ?')
      .all(sessionId, limit, offset) as Message[]
  },
  getHistory(sessionId: string, last = 20): Array<{role:string;content:string}> {
    const msgs = db.prepare("SELECT role,content FROM messages WHERE session_id=? AND role IN ('user','assistant') ORDER BY created_at DESC LIMIT ?")
      .all(sessionId, last) as Array<{role:string;content:string}>
    return msgs.reverse()
  },
  save(data: Omit<Message,'id'|'created_at'>): Message {
    const id = uuidv4(); const now = Date.now()
    db.prepare('INSERT INTO messages (id,session_id,role,content,tool_calls,tokens,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, data.session_id, data.role, data.content, data.tool_calls||null, data.tokens||null, now)
    return db.prepare('SELECT * FROM messages WHERE id=?').get(id) as Message
  },
  count(sessionId: string): number {
    return (db.prepare('SELECT COUNT(*) as c FROM messages WHERE session_id=?').get(sessionId) as any)?.c || 0
  }
}
