import { API_BASE } from '@shared/constants'
import {
  sanitizeMcpApprovalDetails,
  sanitizeMcpErrorDetails,
  type JsonValue,
  type McpApiErrorDetails,
  type McpApprovalState,
  type McpDiscoveredTool,
  type McpPreview,
  type McpRun,
  type McpSafeResult,
  type McpServer,
  type McpServerConfigInput,
  type McpServerPatch,
  type McpTool,
  type McpToolTestResponse,
} from './mcp-servers.types'

const MCP_ROLE = 'admin'
const UI_SESSION_ID = 'mcp-management-ui'

type ApiEnvelope<T> = { data: T }

type RequestOptions = RequestInit & { path: string }

export class McpApiError extends Error {
  readonly code: string
  readonly status: number
  readonly details?: McpApiErrorDetails

  constructor(input: { code: string; message: string; status: number; details?: McpApiErrorDetails }) {
    super(input.message)
    this.name = 'McpApiError'
    this.code = input.code
    this.status = input.status
    this.details = input.details
  }
}

async function request<T>({ path, ...init }: RequestOptions): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'x-bloom-role': MCP_ROLE,
        ...(init.headers ?? {}),
      },
    })
  } catch (cause) {
    throw new McpApiError({
      code: 'NETWORK_ERROR',
      message: cause instanceof Error ? cause.message : 'Network request failed',
      status: 0,
    })
  }

  const payload = await response.json().catch(() => null) as unknown
  if (!response.ok) {
    const envelope = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const error = envelope.error && typeof envelope.error === 'object' ? envelope.error as Record<string, unknown> : envelope
    const code = typeof error.code === 'string' ? error.code : `HTTP_${response.status}`
    const message = typeof error.message === 'string' ? error.message : response.statusText || `HTTP ${response.status}`
    throw new McpApiError({
      code,
      message,
      status: response.status,
      details: sanitizeMcpErrorDetails(error.details),
    })
  }
  if (response.status === 204) return undefined as T
  const data = payload && typeof payload === 'object' && 'data' in payload
    ? (payload as ApiEnvelope<T>).data
    : payload as T
  return data
}

function id(value: string): string { return encodeURIComponent(value) }

export function listMcpServers(): Promise<McpServer[]> {
  return request<McpServer[]>({ path: '/mcp/servers' })
}

export function getMcpServer(serverId: string): Promise<McpServer> {
  return request<McpServer>({ path: `/mcp/servers/${id(serverId)}` })
}

export function createMcpServer(input: McpServerConfigInput): Promise<McpServer> {
  return request<McpServer>({
    path: '/mcp/servers',
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateMcpServer(serverId: string, input: McpServerPatch): Promise<McpServer> {
  return request<McpServer>({
    path: `/mcp/servers/${id(serverId)}`,
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function deleteMcpServer(serverId: string): Promise<{ deleted: true }> {
  return request<{ deleted: true }>({ path: `/mcp/servers/${id(serverId)}`, method: 'DELETE' })
}

export async function testMcpConnection(serverId: string, signal?: AbortSignal): Promise<{ server: McpServer; tools: McpDiscoveredTool[] }> {
  return request({ path: `/mcp/servers/${id(serverId)}/test-connection`, method: 'POST', signal, body: '{}' })
}

export function previewMcpTools(serverId: string, signal?: AbortSignal): Promise<McpPreview> {
  return request<McpPreview>({ path: `/mcp/servers/${id(serverId)}/tools/preview`, method: 'POST', signal, body: '{}' })
}

export function confirmMcpTools(serverId: string, input: { previewId?: string; previewHash: string; configHash: string; catalogVersion: string }): Promise<{ server: McpServer; tools: McpTool[] }> {
  return request({ path: `/mcp/servers/${id(serverId)}/tools/confirm`, method: 'POST', body: JSON.stringify(input) })
}

export function setMcpServerEnabled(serverId: string, enabled: boolean): Promise<McpServer> {
  return request({ path: `/mcp/servers/${id(serverId)}/${enabled ? 'enable' : 'disable'}`, method: 'POST', body: '{}' })
}

export function setMcpServerTrust(serverId: string, trustLevel: 'untrusted' | 'reviewed' | 'trusted'): Promise<McpServer> {
  return request({ path: `/mcp/servers/${id(serverId)}/trust`, method: 'POST', body: JSON.stringify({ trustLevel }) })
}

export function listMcpTools(serverId: string, includeRemoved = true): Promise<McpTool[]> {
  return request<McpTool[]>({ path: `/mcp/servers/${id(serverId)}/tools?includeRemoved=${includeRemoved ? 'true' : 'false'}` })
}

export function updateMcpTool(serverId: string, toolId: string, enabled: boolean): Promise<McpTool> {
  return request<McpTool>({
    path: `/mcp/servers/${id(serverId)}/tools/${id(toolId)}`,
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  })
}

export function testMcpTool(serverId: string, toolId: string, input: JsonValue, signal?: AbortSignal, sessionId = UI_SESSION_ID): Promise<McpToolTestResponse> {
  return request<McpToolTestResponse>({
    path: `/mcp/servers/${id(serverId)}/tools/${id(toolId)}/test`,
    method: 'POST',
    signal,
    headers: { 'x-bloom-session': sessionId },
    body: JSON.stringify({ input }),
  })
}

export function approveMcpRequest(serverId: string, requestId: string, signal?: AbortSignal): Promise<McpToolTestResponse> {
  return request<McpToolTestResponse>({
    path: `/mcp/servers/${id(serverId)}/approvals/${id(requestId)}/approve`,
    method: 'POST',
    signal,
    body: '{}',
  })
}

export function denyMcpRequest(serverId: string, requestId: string): Promise<{ status: 'denied'; run: McpRun }> {
  return request({
    path: `/mcp/servers/${id(serverId)}/approvals/${id(requestId)}/deny`,
    method: 'POST',
    body: '{}',
  })
}

export function listMcpRuns(serverId: string, options: { toolId?: string; status?: string; limit?: number } = {}): Promise<McpRun[]> {
  const query = new URLSearchParams()
  if (options.toolId) query.set('toolId', options.toolId)
  if (options.status) query.set('status', options.status)
  if (options.limit) query.set('limit', String(options.limit))
  const suffix = query.toString() ? `?${query.toString()}` : ''
  return request<McpRun[]>({ path: `/mcp/servers/${id(serverId)}/runs${suffix}` })
}

export function getApprovalDetails(error: unknown): McpApprovalState | undefined {
  if (!(error instanceof McpApiError)) return undefined
  return sanitizeMcpApprovalDetails(error.details)
}
