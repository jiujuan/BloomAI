import { describe, expect, it, vi } from 'vitest'
import type { Tool, ToolRun } from '../../db/repositories/tool.repo'
import { createFakeSkillRuntimePorts } from '../application/test-doubles'
import { CapabilityBroker, CapabilityDeniedError } from './capability-broker'

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

function createBroker() {
  const ports = createFakeSkillRuntimePorts({ now: 100 })
  const version = ports.packages.createVersion({ packageId: 'pkg-1', version: '1.0.0', manifest: {}, manifestHash: 'hash', packagePath: '/pkg' })
  const run = ports.runs.createRun({ skillVersionId: version.id, status: 'running', input: {}, context: {} })
  ports.grants.createCapabilityGrant({ skillVersionId: version.id, capability: 'web.search', grantMode: 'persistent' })
  ports.grants.createCapabilityGrant({ skillVersionId: version.id, capability: 'web.fetch', grantMode: 'persistent' })
  const toolRun: ToolRun = {
    id: 'tool-run-1',
    tool_id: 'web_search',
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
    get: vi.fn((id: string) => createTool(id)),
    startRun: vi.fn(() => toolRun),
    completeRun: vi.fn(),
    failRun: vi.fn(),
    getPermission: vi.fn(),
  }
  const executeTool = vi.fn(async (toolId: string) => ({
    toolRunId: toolId === 'web_fetch' ? 'tool-run-fetch' : toolRun.id,
    output: { ok: true, toolId },
  }))
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
  })
  return { broker, ports, run, executeTool, tools }
}

describe('CapabilityBroker package execution contract', () => {
  it('normalizes successful calls and records requested, started, completed, and audit events', async () => {
    const { broker, ports, run } = createBroker()

    const result = await broker.executeCapability({
      caller: 'package-runtime',
      capability: 'web.search',
      input: { query: 'bloomai' },
      runId: run.id,
      sessionId: 'session-1',
      idempotencyKey: 'call-1',
      requestedTimeoutMs: 60_000,
    })

    expect(result).toMatchObject({
      status: 'completed',
      output: { ok: true, toolId: 'web_search' },
      artifactIds: [],
      retryable: false,
      usage: { calls: 1 },
      errorCode: null,
    })
    expect(ports.events.listEvents(run.id).map((event) => event.type)).toEqual([
      'capability.requested',
      'capability.started',
      'capability.completed',
      'capability.call',
    ])
  })

  it('replays an idempotent result without invoking the tool twice', async () => {
    const { broker, run, executeTool } = createBroker()
    const request = {
      caller: 'package-runtime' as const,
      capability: 'web.search',
      input: { query: 'same' },
      runId: run.id,
      idempotencyKey: 'same-call',
    }

    const first = await broker.executeCapability(request)
    const second = await broker.executeCapability(request)

    expect(second).toEqual(first)
    expect(executeTool).toHaveBeenCalledTimes(1)
  })

  it('caps caller timeout requests at the server-side tool timeout', async () => {
    const { broker, run, executeTool } = createBroker()

    await broker.executeCapability({
      caller: 'package-runtime',
      capability: 'web.fetch',
      input: { url: 'https://example.com' },
      runId: run.id,
      requestedTimeoutMs: 600_000,
    })

    expect(executeTool).toHaveBeenCalledWith(
      'web_fetch',
      { url: 'https://example.com' },
      undefined,
      60_000,
      expect.objectContaining({ caller: 'package-runtime' }),
    )
  })

  it.each(['mcp', 'mcp.execute', 'container.execute', 'arbitrary_workspace_write'])('rejects forbidden capability %s before the tool layer', async (capability) => {
    const { broker, run, executeTool } = createBroker()

    await expect(broker.executeCapability({
      caller: 'package-runtime',
      capability,
      input: {},
      runId: run.id,
    })).rejects.toBeInstanceOf(CapabilityDeniedError)
    expect(executeTool).not.toHaveBeenCalled()
  })

  it('requires run ownership context for package capabilities', async () => {
    const { broker, executeTool } = createBroker()

    await expect(broker.executeCapability({
      caller: 'package-runtime',
      capability: 'web.search',
      input: { query: 'missing-run' },
    })).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' })
    expect(executeTool).not.toHaveBeenCalled()
  })
})
