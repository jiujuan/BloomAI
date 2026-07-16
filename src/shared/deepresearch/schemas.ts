import { z } from 'zod'

export const startResearchSchema = z.object({
  sessionId: z.string().min(1).optional(),
  topic: z.string().trim().min(3).max(4000),
  profile: z.enum(['general', 'market', 'competitor', 'academic']),
  depth: z.enum(['standard', 'deep', 'exhaustive']),
  objective: z.string().trim().min(1).max(4000).optional(),
  audience: z.string().trim().min(1).max(500).optional(),
  geography: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  timeRange: z.object({
    from: z.string().min(1).optional(),
    to: z.string().min(1).optional(),
  }).optional(),
  preferredDomains: z.array(z.string().trim().min(1).max(253)).max(30).optional(),
  excludedDomains: z.array(z.string().trim().min(1).max(253)).max(30).optional(),
  attachmentIds: z.array(z.string().min(1)).max(20).optional(),
  model: z.string().min(1).optional(),
})

export const clarificationSchema = z.object({
  clarificationId: z.string().trim().min(1),
  answer: z.string().trim().min(1).max(4000),
})
