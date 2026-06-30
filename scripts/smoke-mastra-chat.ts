import fs from 'node:fs'
import path from 'node:path'
import { RequestContext } from '@mastra/core/request-context'
import { handleChatStream } from '@mastra/ai-sdk'
import { runMigrations } from '../src/server/db/client'
import { mastra } from '../src/server/mastra'

// Load .env into process.env so Mastra's model gateway sees ANTHROPIC_API_KEY etc.
function loadDotEnv(): void {
  const envPath = path.join(process.cwd(), '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const [, key, rawValue] = m
    const value = rawValue.replace(/^['"]|['"]$/g, '')
    if (!process.env[key]) process.env[key] = value
  }
}

async function main() {
  loadDotEnv()
  await runMigrations()

  const question = process.argv[2] ?? 'In one sentence, what is the capital of France?'
  const model = process.argv[3] ?? 'agnes-2.0-flash'
  const requestContext = new RequestContext()
  requestContext.set('mode', 'chat')
  requestContext.set('model', model)
  requestContext.set('sessionId', 'smoke')

  console.log('[smoke] question:', question, '| model:', model)
  const stream = await handleChatStream({
    mastra,
    agentId: 'chat',
    version: 'v6',
    sendReasoning: true,
    params: {
      requestContext,
      messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: question }] }],
    } as any,
  })

  const counts: Record<string, number> = {}
  let text = ''
  for await (const chunk of stream as any) {
    const type = chunk?.type ?? 'unknown'
    counts[type] = (counts[type] ?? 0) + 1
    if (type === 'text-delta' && typeof chunk.delta === 'string') text += chunk.delta
    if (/error/i.test(type)) console.log('[smoke] error chunk:', JSON.stringify(chunk).slice(0, 400))
  }

  console.log('[smoke] chunk type counts:', counts)
  console.log('[smoke] assembled text:', text.trim().slice(0, 500))
}

main().catch((err) => {
  console.error('[smoke] FAILED:', err)
  process.exit(1)
})
