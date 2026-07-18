import { z } from 'zod'

const loopStopDecisionSchema = z.enum([
  'stop_covered',
  'stop_budget',
  'stop_no_material_gain',
  'stop_no_actionable_gaps',
  'stop_cancelled',
  'stop_max_iterations',
  'stop_blocked',
])

export const iterationBriefSchema = z.object({
  title: z.string(),
  objective: z.string().nullable(),
  audience: z.string().nullable(),
  scope: z.string(),
  assumptions: z.array(z.string()),
  plannedSections: z.array(z.string()),
  criticalClarificationIds: z.array(z.string()),
})

export const iterationContextSchema = z.object({
  runId: z.string().min(1),
  brief: iterationBriefSchema,
  coverageComplete: z.boolean(),
  marginalNewEvidenceCount: z.number().int().nonnegative(),
  cancelled: z.boolean(),
  iterations: z.number().int().nonnegative(),
  maxIterations: z.number().int().nonnegative(),
  iterationId: z.string().min(1).nullable().optional(),
  queryIds: z.array(z.string().min(1)).optional(),
  sourceIds: z.array(z.string().min(1)).optional(),
  /** A durable decision, not a transient evidence-count heuristic, controls loop termination. */
  stopDecision: loopStopDecisionSchema.nullable().optional(),
  limitations: z.array(z.string()).optional(),
})

export type IterationContext = z.infer<typeof iterationContextSchema>
