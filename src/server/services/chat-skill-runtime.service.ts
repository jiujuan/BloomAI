import { messageRepo } from '../db/repositories/message.repo'
import { sessionRepo } from '../db/repositories/session.repo'
import { createSqlitePackageRepository } from '../db/repositories/skill-package.repo'
import { createChatSkillLauncher } from '../skills/application/chat-skill-launcher'
import { skillPackageRuntimeService } from './skill-package-runtime.service'

/**
 * HTTP routes consume this facade instead of assembling the chat Skill runtime
 * from repositories and application internals themselves.
 */
export const chatSkillLauncher = createChatSkillLauncher({
  packages: createSqlitePackageRepository(),
  sessions: sessionRepo,
  messages: messageRepo,
  runtime: {
    startRun: (input) => skillPackageRuntimeService.startRun(input),
    findChatRunByIdempotency: (sessionId, idempotencyKey) =>
      skillPackageRuntimeService.findChatRunByIdempotency(sessionId, idempotencyKey),
  },
})

export function chatSessionExists(sessionId: string): boolean {
  return Boolean(sessionRepo.get(sessionId))
}
