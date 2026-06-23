import { Router, Request, Response } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '../db/client'
import { sessionRepo } from '../db/repositories/session.repo'
import { messageRepo } from '../db/repositories/message.repo'
import { personaRepo } from '../db/repositories/persona.repo'
import { setupSSE, sendSSE, endSSE } from '../middleware/index'

export const chatRouter = Router()

chatRouter.post('/stream', async (req: Request, res: Response) => {
  setupSSE(res)
  const { sessionId, content, contextOverride } = req.body
  if (!sessionId || !content) {
    sendSSE(res, { type: 'error', error: 'sessionId and content required' })
    return endSSE(res)
  }

  const keyRow = db.prepare("SELECT value FROM settings WHERE key='anthropic_api_key'").get() as any
  const apiKey = keyRow?.value || process.env.ANTHROPIC_API_KEY || ''
  if (!apiKey) {
    sendSSE(res, { type: 'error', error: 'No API key. Please configure your Anthropic API key in Settings.' })
    return endSSE(res)
  }

  const session = sessionRepo.get(sessionId)
  if (!session) {
    sendSSE(res, { type: 'error', error: 'Session not found' })
    return endSSE(res)
  }

  const persona = session.persona_id ? personaRepo.get(session.persona_id) : null
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
    const client = new Anthropic({ apiKey })
    const stream = client.messages.stream({
      model: persona?.model_override || session.model || 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      system,
      messages,
    })
    stream.on('text', (text) => {
      fullText += text
      sendSSE(res, { type: 'delta', text })
    })
    stream.on('message', (msg) => {
      inTok = msg.usage.input_tokens
      outTok = msg.usage.output_tokens
    })
    await stream.finalMessage()
    messageRepo.save({ session_id: sessionId, role: 'assistant', content: fullText, tokens: inTok + outTok })
    sendSSE(res, { type: 'done', tokens: { input: inTok, output: outTok } })
  } catch (err: any) {
    console.error('[Chat stream]', err.message)
    if (fullText) messageRepo.save({ session_id: sessionId, role: 'assistant', content: fullText })
    sendSSE(res, { type: 'error', error: err.message || 'AI request failed' })
  }
  endSSE(res)
})
