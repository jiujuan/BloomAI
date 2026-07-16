import { messageRepo, type Message } from '../db/repositories/message.repo'
import { sessionRepo, type Session } from '../db/repositories/session.repo'
import { ServiceError } from './errors'

export interface CreateSessionInput {
  title?: string
  persona_id?: string
  model?: string
}

export interface UpdateSessionInput {
  title?: string
  persona_id?: string | null
  model?: string
}

export interface ListSessionMessagesInput {
  limit: number
  offset: number
}

export type SessionDto = Session
export type MessageDto = Message

export interface SessionMessagesPageDto {
  data: MessageDto[]
  meta: {
    total: number
    limit: number
    offset: number
  }
}

function toSessionDto(session: Session): SessionDto {
  return { ...session }
}

function toMessageDto(message: Message): MessageDto {
  return { ...message }
}

function getRequiredSession(id: string): Session {
  const session = sessionRepo.get(id)
  if (!session) throw new ServiceError('NOT_FOUND', 'Session not found')
  return session
}

function validatePagination({ limit, offset }: ListSessionMessagesInput): void {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new ServiceError('VALIDATION_ERROR', 'limit must be a non-negative integer')
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ServiceError('VALIDATION_ERROR', 'offset must be a non-negative integer')
  }
}

/**
 * Application boundary for chat-session CRUD. Deletion is a soft archive: it
 * removes the session from active lists while retaining its messages in storage.
 */
export const sessionService = {
  list(): SessionDto[] {
    return sessionRepo.list().map(toSessionDto)
  },

  create(input: CreateSessionInput = {}): SessionDto {
    return toSessionDto(sessionRepo.create(input))
  },

  get(id: string): SessionDto {
    return toSessionDto(getRequiredSession(id))
  },

  update(id: string, input: UpdateSessionInput): SessionDto {
    getRequiredSession(id)
    const session = sessionRepo.update(id, input)
    if (!session) throw new ServiceError('NOT_FOUND', 'Session not found')
    return toSessionDto(session)
  },

  remove(id: string): void {
    getRequiredSession(id)
    sessionRepo.delete(id)
  },

  listMessages(id: string, input: ListSessionMessagesInput): SessionMessagesPageDto {
    getRequiredSession(id)
    validatePagination(input)

    return {
      data: messageRepo.list(id, input.limit, input.offset).map(toMessageDto),
      meta: {
        total: messageRepo.count(id),
        limit: input.limit,
        offset: input.offset,
      },
    }
  },
}