import { Memory } from '@mastra/memory'
import { LibSQLStore } from '@mastra/libsql'
import { pathToFileURL } from 'url'
import { mkdirSync } from 'fs'
import path from 'path'
import os from 'os'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Directory resolution
// ---------------------------------------------------------------------------

function resolveDir(raw: string): string {
  const expanded = raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : path.resolve(raw)
  return expanded
}

const memoryDir = resolveDir(
  process.env.MEMORY_DATA_DIR || path.join('~', '.bloomai', 'memory'),
)

// Ensure the directory exists before libSQL tries to open the file
mkdirSync(memoryDir, { recursive: true })

const memoryDbUrl = pathToFileURL(path.join(memoryDir, 'memory.db')).href

// ---------------------------------------------------------------------------
// Working Memory schema
// Structured facts the LLM maintains across turns via tool calls (merge semantics:
// only updated fields need to be returned, existing ones are preserved automatically).
// ---------------------------------------------------------------------------

const workingMemorySchema = z.object({
  language: z
    .string()
    .describe('Preferred language for responses, e.g. 中文, English')
    .optional(),
  communicationStyle: z
    .string()
    .describe('Preferred tone or style, e.g. concise, detailed, friendly')
    .optional(),
  expertiseLevel: z
    .string()
    .describe('Domain expertise level relevant to the conversation, e.g. beginner / expert in Python')
    .optional(),
  keyFacts: z
    .array(z.string())
    .describe('Important facts learned about the user or their context')
    .optional(),
  currentGoals: z
    .array(z.string())
    .describe('Active tasks or goals the user is working on')
    .optional(),
  importantContext: z
    .string()
    .describe('Critical context that must persist across sessions')
    .optional(),
})

// ---------------------------------------------------------------------------
// Observational Memory model resolution
// Picks the cheapest available provider from env-var-based API keys so that
// the Observer/Reflector can run without extra configuration.
// Set MEMORY_OBSERVATION_MODEL to override (Mastra router format: "provider/model-id").
// ---------------------------------------------------------------------------

function resolveObservationModel(): string | undefined {
  if (process.env.MEMORY_OBSERVATION_MODEL?.trim()) return process.env.MEMORY_OBSERVATION_MODEL.trim()
  if (process.env.ANTHROPIC_API_KEY?.startsWith('sk-')) return 'anthropic/claude-haiku-4-5-20251001'
  if (process.env.OPENAI_API_KEY?.startsWith('sk-')) return 'openai/gpt-4o-mini'
  if (process.env.GOOGLE_API_KEY) return 'google/gemini-2.5-flash'
  return undefined
}

const observationModel = resolveObservationModel()
const lastMessages = Math.max(1, parseInt(process.env.MEMORY_LAST_MESSAGES || '20', 10) || 20)

// ---------------------------------------------------------------------------
// Single shared Memory instance used by all agents that participate in memory.
// - Working Memory (resource scope): persists user preferences / key facts across ALL
//   sessions for this local user.  The LLM updates it via a lightweight tool call.
// - Observational Memory (thread scope): when the conversation's token count exceeds
//   the internal threshold, old messages are compressed into structured observations
//   so the context window stays bounded without losing key details.
// - lastMessages: only the most recent N turns are fed directly to the LLM; older
//   turns are handled by Observational Memory (if enabled) or discarded.
// ---------------------------------------------------------------------------

export const BLOOMAI_RESOURCE_ID = 'bloomai-local-user'

export const chatMemory = new Memory({
  storage: new LibSQLStore({
    id: 'bloomai-memory',
    url: memoryDbUrl,
  }),
  options: {
    lastMessages,

    workingMemory: {
      enabled: true,
      // resource scope: one working-memory record per local user, shared across sessions.
      // Thread scope would give each session its own scratchpad — use that if you want
      // session-isolated state instead.
      scope: 'resource',
      schema: workingMemorySchema,
    },

    ...(observationModel
      ? {
          observationalMemory: {
            model: observationModel,
            // thread scope: compress each conversation independently so observation
            // stays fast even when the user has many sessions.
            scope: 'thread',
            // enables the recall tool so the LLM can browse compressed observations
            // without needing a vector store.
            retrieval: true,
          },
        }
      : {}),
  },
})
