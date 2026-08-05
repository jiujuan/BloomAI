import { describe, expect, it, vi } from 'vitest'
import { createFakeSkillRuntimePorts } from '../application/test-doubles'
import type { Tool, ToolRun } from '../../db/repositories/tool.repo'

function createTool(id: string): Tool {
  return {
    id,
    category: 'web',
    name: id,
    description: id,
    params_schema: '{}',
    result_schema: '{}',
    is_builtin: 1,
    is_enabled: 1,
    requires_permission: null,
    created_at: 0,
  }
}

describe('CapabilityBroker injected ports', () => {
  it('executes package capabilities without initializing the global database', async () => {
    const ports = createFakeSkillRuntimePorts({ now: 100 })
    const version = ports.packages.createVersion({ packageId: 'pkg-1', version: '1.0.0', manifest: {}, manifestHash: 'hash', packagePath: '/pkg' })
    const run = ports.runs.createRun({ skillVersionId: version.id, status: 'running', input: {}, context: {} })
    ports.grants.createCapabilityGrant({ skillVersionId: version.id, capability: 'web.search', grantMode: 'persistent' })

    const tool = createTool('web_search')
    const toolRun: ToolRun = {
      id: 'tool-run-1',
      tool_id: tool.id,
      session_id: 'session-1',
      input_json: '{}',
      output_json: null,
      status: 'running',
      error_msg: null,
      duration_ms: null,
      started_at: 100,
      finished_at: null,
    }
    const tools = {
      get: vi.fn(() => tool),
      startRun: vi.fn(() => toolRun),
      completeRun: vi.fn(),
      failRun: vi.fn(),
      getPermission: vi.fn(),
    }

    const { CapabilityBroker } = await import('./capability-broker')
    const broker = new CapabilityBroker({
      runs: ports.runs,
      grants: ports.grants,
      events: ports.events,
      tools,
      executeTool: vi.fn(async () => ({ toolRunId: toolRun.id, output: { results: [] } })),
      getToolAvailability: vi.fn(() => ({ status: 'available' as const })),
      approvals: { consume: vi.fn() },
      permissions: { has: vi.fn(() => false) },
      imageAdapterFactory: () => ({ run: vi.fn() }) as never,
    })

    await expect(broker.executeCapability({
      caller: 'package-runtime',
      capability: 'web.search',
      input: { query: 'injected' },
      runId: run.id,
      sessionId: 'session-1',
    })).resolves.toMatchObject({ toolId: 'web_search', toolRunId: toolRun.id, output: { results: [] } })
    expect(ports.events.listEvents(run.id)).toHaveLength(1)
    expect(tools.get).toHaveBeenCalledWith('web_search')
  })
})
