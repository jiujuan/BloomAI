import { Router, Request, Response } from 'express'
import { db } from '../db/client'
import { sessionRepo } from '../db/repositories/session.repo'
import { messageRepo } from '../db/repositories/message.repo'
import { personaRepo, type Persona } from '../db/repositories/persona.repo'
import { streamChatCompletion } from '../llm'
import { setupSSE, sendSSE, endSSE } from '../middleware/index'

export const chatRouter = Router()

const FALLBACK_CHAT_MODEL = 'claude-3-5-sonnet-20241022'
const LEGACY_BUILTIN_PERSONA_MODELS = new Set([
  'claude-3-5-sonnet-20241022',
  'claude-3-opus-20240229',
])

function getSettingsModel(): string {
  return (db.prepare("SELECT value FROM settings WHERE key='model'").get() as any)?.value || ''
}

function getPersonaModelOverride(persona: Persona | null): string {
  const override = persona?.model_override || ''
  if (!override) return ''
  if (persona?.is_builtin && LEGACY_BUILTIN_PERSONA_MODELS.has(override)) return ''
  return override
}

function getSessionModelOverride(sessionModel: string): string {
  if (!sessionModel) return ''
  if (sessionModel === FALLBACK_CHAT_MODEL) return ''
  return sessionModel
}

function resolveChatModel(persona: Persona | null, sessionModel: string, settingsModel: string): string {
  return getPersonaModelOverride(persona) || getSessionModelOverride(sessionModel) || settingsModel || sessionModel || FALLBACK_CHAT_MODEL
}

chatRouter.post('/stream', async (req: Request, res: Response) => {
  setupSSE(res)
  const { sessionId, content, contextOverride } = req.body
  if (!sessionId || !content) {
    sendSSE(res, { type: 'error', error: 'sessionId and content required' })
    return endSSE(res)
  }

  const session = sessionRepo.get(sessionId)
  if (!session) {
    sendSSE(res, { type: 'error', error: 'Session not found' })
    return endSSE(res)
  }

  const persona = session.persona_id ? personaRepo.get(session.persona_id) || null : null
  const history = messageRepo.getHistory(sessionId, 20)
  const basePrompt = persona?.system_prompt || 'You are BloomAI, a helpful AI assistant. Be concise, accurate, and friendly.'

  const ctxParts: string[] = []
  if (contextOverride?.activeApp) ctxParts.push(`Active app: ${contextOverride.activeApp}`)
  if (contextOverride?.clipboardContent) ctxParts.push(`Clipboard:\n${String(contextOverride.clipboardContent).slice(0,800)}`)
  const system = ctxParts.length ? `${basePrompt}\n\n---\n${ctxParts.join('\n')}` : basePrompt

  messageRepo.save({ session_id: sessionId, role: 'user', content })
  sessionRepo.touch(sessionId)

  if (history.length === 0) {
    sessionRepo.update(sessionId, { title: content.slice(0, 60).trim() })
  }

  const messages = [
    ...history.map(m => ({ role: m.role as 'user'|'assistant', content: m.content })),
    { role: 'user' as const, content }
  ]

  let fullText = ''; let inTok = 0; let outTok = 0
  try {
    const model = resolveChatModel(persona, session.model, getSettingsModel())

    for await (const event of streamChatCompletion({
      model,
      maxTokens: 4096,
      system,
      messages,
    })) {
      if (event.type === 'delta') {
        fullText += event.text
        sendSSE(res, { type: 'delta', text: event.text })
      }
      if (event.type === 'usage') {
        inTok = event.input
        outTok = event.output
      }
    }

    messageRepo.save({ session_id: sessionId, role: 'assistant', content: fullText, tokens: inTok + outTok })
    sendSSE(res, { type: 'done', tokens: { input: inTok, output: outTok } })
  } catch (err: any) {
    console.error('[Chat stream]', err.message)
    if (fullText) messageRepo.save({ session_id: sessionId, role: 'assistant', content: fullText })
    sendSSE(res, { type: 'error', error: err.message || 'AI request failed' })
  }
  endSSE(res)
})
