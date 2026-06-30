import { z } from 'zod'

export const MessageSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  tool_calls: z.string().optional().nullable(),
  tokens: z.number().optional().nullable(),
  created_at: z.number(),
})

export const SessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  persona_id: z.string().optional().nullable(),
  model: z.string(),
  status: z.string(),
  created_at: z.number(),
  updated_at: z.number(),
})

export const PersonaSchema = z.object({
  id: z.string(),
  name: z.string(),
  system_prompt: z.string(),
  model_override: z.string().optional().nullable(),
  is_builtin: z.number(),
  created_at: z.number(),
})

export const ChatStreamPayloadSchema = z.object({
  sessionId: z.string(),
  content: z.string().min(1),
  contextOverride: z.object({
    activeApp: z.string().optional(),
    clipboardContent: z.string().optional(),
  }).optional(),
})

export type Message = z.infer<typeof MessageSchema>
export type Session = z.infer<typeof SessionSchema>
export type Persona = z.infer<typeof PersonaSchema>
export type ChatStreamPayload = z.infer<typeof ChatStreamPayloadSchema>
