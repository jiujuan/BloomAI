import { describe, expect, it } from 'vitest'
import {
  SCHEDULED_TASK_AGENT_ID,
  SCHEDULED_TASK_INSTRUCTIONS,
  scheduledTaskAgent,
} from './scheduled-task-agent'

describe('scheduledTaskAgent', () => {
  it('uses the fixed task-only agent id and explicit stateless instructions', () => {
    expect(SCHEDULED_TASK_AGENT_ID).toBe('scheduled-task')
    expect(scheduledTaskAgent.id).toBe(SCHEDULED_TASK_AGENT_ID)
    expect(SCHEDULED_TASK_INSTRUCTIONS).toContain('stateless')
    expect(SCHEDULED_TASK_INSTRUCTIONS).toContain('independent from Chat')
    expect(SCHEDULED_TASK_INSTRUCTIONS).toContain('conversation history')

    expect(scheduledTaskAgent.getInstructions()).toEqual(SCHEDULED_TASK_INSTRUCTIONS)
  })

  it('exposes no task tools', () => {
    expect(scheduledTaskAgent.listTools()).toEqual({})
  })
})
