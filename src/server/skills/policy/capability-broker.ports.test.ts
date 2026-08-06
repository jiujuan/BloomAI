import { describe, expect, it, vi } from 'vitest'
import { createFakeSkillRuntimePorts } from '../application/test-doubles'
import type { Tool, ToolRun } from '../../db/repositories/tool.repo'
import { SkillRuntimeMetrics } from '../observability/skill-runtime.metrics'
import { getSkillCorrelation } from '../observability/skill-runtime.logger'

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
    expect(ports.events.listEvents(run.id).filter((event) => event.type === 'capability.call')).toHaveLength(1)
    expect(tools.get).toHaveBeenCalledWith('web_search')
  })

  it('records capability latency, outcome, and bounded correlation fields', async () => {
    const ports = createFakeSkillRuntimePorts({ now: 100 })
    const version = ports.packages.createVersion({ packageId: 'pkg-2', version: '1.0.0', manifest: {}, manifestHash: 'hash-2', packagePath: '/pkg-2' })
    const run = ports.runs.createRun({ skillVersionId: version.id, status: 'running', input: {}, context: {} })
    const grant = ports.grants.createCapabilityGrant({ skillVersionId: version.id, capability: 'web.search', grantMode: 'persistent' })
    const tool = createTool('web_search')
    const toolRun: ToolRun = {
      id: 'tool-run-2',
      tool_id: tool.id,
      session_id: 'session-2',
      input_json: '{}',
      output_json: null,
      status: 'running',
      error_msg: null,
      duration_ms: null,
      started_at: 100,
      finished_at: null,
    }
    let now = 100
    const metrics = new SkillRuntimeMetrics({ now: () => now })
    const tools = {
      get: vi.fn(() => tool),
      startRun: vi.fn(() => toolRun),
      completeRun: vi.fn(),
      failRun: vi.fn(),
      getPermission: vi.fn(),
    }
    let observedCorrelation: ReturnType<typeof getSkillCorrelation> = {}
    const executeTool = vi.fn(async () => {
      observedCorrelation = getSkillCorrelation()
      now = 160
      return { toolRunId: toolRun.id, output: { results: [] } }
    })

    const { CapabilityBroker } = await import('./capability-broker')
    const broker = new CapabilityBroker({
      runs: ports.runs,
      grants: ports.grants,
      events: ports.events,
      tools,
      executeTool,
      getToolAvailability: vi.fn(() => ({ status: 'available' as const })),
      approvals: { consume: vi.fn() },
      permissions: { has: vi.fn(() => false) },
      imageAdapterFactory: () => ({ run: vi.fn() }) as never,
      metrics,
      now: () => now,
    })

    await expect(broker.executeCapability({
      caller: 'package-runtime',
      capability: 'web.search',
      input: { query: 'bounded' },
      runId: run.id,
      sessionId: 'session-2',
    })).resolves.toMatchObject({ toolRunId: toolRun.id })

    const snapshot = metrics.snapshot()
    expect(snapshot.counters.capabilityCalls).toBe(1)
    expect(snapshot.counters.capabilityLatencyMs).toBe(60)
    expect(snapshot.counters.capabilityErrors).toEqual({})
    expect(snapshot.points).toContainEqual(expect.objectContaining({
      kind: 'capability',
      attributes: expect.objectContaining({ capability: 'web.search', outcome: 'success', error_code: 'none' }),
    }))
    expect(snapshot.points.at(-1)?.attributes).not.toEqual(expect.objectContaining({ query: 'bounded' }))
    expect(observedCorrelation).toEqual({
      runId: run.id,
      skillVersionId: version.id,
      grantId: grant.id,
    })
    expect(grant.id).toEqual(expect.any(String))
  })


  it('records stable error codes for denied capability calls', async () => {
    const ports = createFakeSkillRuntimePorts({ now: 100 })
    const version = ports.packages.createVersion({ packageId: 'pkg-3', version: '1.0.0', manifest: {}, manifestHash: 'hash-3', packagePath: '/pkg-3' })
    const run = ports.runs.createRun({ skillVersionId: version.id, status: 'running', input: {}, context: {} })
    const metrics = new SkillRuntimeMetrics({ now: () => 100 })
    const tool = createTool('web_search')
    const { CapabilityBroker, CapabilityApprovalRequiredError } = await import('./capability-broker')
    const broker = new CapabilityBroker({
      runs: ports.runs,
      grants: ports.grants,
      events: ports.events,
      tools: {
        get: vi.fn(() => tool),
        startRun: vi.fn(),
        completeRun: vi.fn(),
        failRun: vi.fn(),
        getPermission: vi.fn(),
      },
      executeTool: vi.fn(),
      getToolAvailability: vi.fn(() => ({ status: 'available' as const })),
      approvals: { consume: vi.fn() },
      permissions: { has: vi.fn(() => false) },
      imageAdapterFactory: () => ({ run: vi.fn() }) as never,
      metrics,
      now: () => 100,
    })

    await expect(broker.executeCapability({
      caller: 'package-runtime',
      capability: 'web.search',
      input: { query: 'denied' },
      runId: run.id,
    })).rejects.toBeInstanceOf(CapabilityApprovalRequiredError)

    expect(metrics.snapshot().counters).toMatchObject({
      capabilityCalls: 1,
      capabilityErrors: { APPROVAL_REQUIRED: 1 },
    })
    expect(version.id).toEqual(expect.any(String))
  })

})
