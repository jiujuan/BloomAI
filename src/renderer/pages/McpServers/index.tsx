import React, { useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertCircle, Ban, CheckCircle2, Clock3, FileDiff, Globe2,
  LoaderCircle, Pencil, Play, Plus, RefreshCw, Save, Server, ShieldCheck,
  Terminal, Trash2, Wrench, X,
} from 'lucide-react'
import { cn } from '@renderer/utils'
import { useMcpServersStore, type McpServersState } from './mcp-servers.store'
import {
  sanitizeMcpApprovalDetails,
  type JsonValue,
  type McpApprovalState,
  type McpDiscoveredTool,
  type McpPreview,
  type McpPreviewDiff,
  type McpRun,
  type McpSafeResult,
  type McpServer,
  type McpServerConfigInput,
  type McpServerPatch,
  type McpTool,
  type McpTransportKind,
} from './mcp-servers.types'

export { sanitizeMcpApprovalDetails }

const SECRET_REFERENCE_PATTERN = /^\$\{env:[A-Za-z_][A-Za-z0-9_]*\}$/
type EditorFormState = { name: string; transportKind: McpTransportKind; command: string; args: string; cwd: string; envLines: string; url: string; headerLines: string }


function formatDate(value: number | null | undefined): string {
  if (!value) return '—'
  try { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) } catch { return '—' }
}
function formatStatus(value: string): string { return value.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') }
function formatRisk(value: string): string { return value }
function isExpired(value: number): boolean { return value <= Date.now() }
function jsonPreview(value: unknown, max = 640): string {
  let text = '—'
  try { text = JSON.stringify(value, null, 2) ?? '—' } catch { text = '[unavailable]' }
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}
function statusTone(status: string): 'ok' | 'warn' | 'danger' | 'muted' {
  if (status === 'healthy' || status === 'success') return 'ok'
  if (status === 'error' || status === 'denied' || status === 'cancelled') return 'danger'
  if (status === 'pending_approval' || status === 'running' || status === 'reviewed') return 'warn'
  return 'muted'
}
function safeCommandArg(value: string): string { return SECRET_REFERENCE_PATTERN.test(value) ? '[secret ref]' : value }
function transportLabel(server: McpServer): string { return server.transport.kind === 'stdio' ? 'stdio' : 'Streamable HTTP' }
function transportSummary(server: McpServer): string {
  if (server.transport.kind === 'stdio') return [server.transport.command, ...server.transport.args.map(safeCommandArg)].join(' ').trim() || 'stdio command'
  return `${server.transport.origin}${server.transport.headers.length ? ` · headers: ${server.transport.headers.join(', ')}` : ''}`
}
function uiErrorMessage(code: string, message: string): string {
  const hints: Record<string, string> = {
    MCP_DISABLED: 'The MCP client is disabled by the server feature flag.',
    MCP_PREVIEW_STALE: 'This preview is stale. Refresh it before confirming the catalog.',
    MCP_CONFIG_INVALID: 'The server configuration is invalid. Check the transport and secret references.',
    MCP_CONNECTION_FAILED: 'The MCP server could not be reached. Check the connection and try again.',
    MCP_SERVER_DISABLED: 'Enable the server before connecting or testing a tool.',
    MCP_TOOL_DISABLED: 'This tool is disabled by policy.',
    MCP_APPROVAL_REQUIRED: 'Approval is required before this tool can run.',
    NETWORK_ERROR: 'The management API is unavailable. Check the BloomAI server connection.',
  }
  return hints[code] ?? message
}
function ToneBadge({ tone, children }: { tone: 'ok' | 'warn' | 'danger' | 'muted'; children: React.ReactNode }) { return <span className={cn('mcp-badge', tone)}>{children}</span> }
function BusyLabel({ busy }: { busy: boolean }) { return busy ? <LoaderCircle className="mcp-spin" size={14} aria-hidden="true" /> : null }

export function McpServerCard({ server, toolCount, onSelect, selected = false }: { server: McpServer; toolCount?: number; onSelect: () => void; selected?: boolean }) {
  const tone = statusTone(server.connectionStatus)
  return <article className={cn('mcp-server-card', selected && 'selected')} role="button" tabIndex={0} aria-pressed={selected} onClick={onSelect} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect() } }}>
    <div className="mcp-server-card-head"><div className="mcp-server-card-icon"><Server size={17} /></div><div className="mcp-server-card-title"><strong>{server.name}</strong><span>{transportLabel(server)}</span></div><ToneBadge tone={server.isEnabled ? 'ok' : 'muted'}>{server.isEnabled ? 'Enabled' : 'Disabled'}</ToneBadge></div>
    <div className="mcp-server-card-summary" title={transportSummary(server)}>{server.transport.kind === 'stdio' ? <Terminal size={13} /> : <Globe2 size={13} />}<span>{transportSummary(server)}</span></div>
    <div className="mcp-server-card-meta"><span><i className={cn('mcp-status-dot', tone)} />{formatStatus(server.connectionStatus)}</span><span>Trust {formatStatus(server.trustLevel)}</span><span>Catalog v{server.catalogVersion}</span><span>{toolCount === undefined ? '—' : toolCount} tools</span></div>
  </article>
}

export function McpToolPolicyTable({ tools, onToggle, onTest, busyToolId }: { tools: McpTool[]; onToggle: (tool: McpTool) => void; onTest: (tool: McpTool) => void; busyToolId?: string | null }) {
  if (!tools.length) return <div className="mcp-empty-inline">No confirmed tools yet. Refresh the catalog to discover tools.</div>
  return <div className="mcp-table-wrap"><table className="mcp-table"><thead><tr><th>Remote tool</th><th>Risk</th><th>Approval</th><th>Schema</th><th>Status</th><th aria-label="Actions" /></tr></thead><tbody>{tools.map((tool) => {
    const busy = busyToolId === tool.id
    return <tr key={tool.id} className={cn(tool.isRemoved && 'removed')}><td><div className="mcp-tool-name">{tool.remoteName}</div><div className="mcp-tool-description">{tool.description || 'No description'}</div></td><td><ToneBadge tone={tool.riskLevel === 'high' ? 'danger' : tool.riskLevel === 'medium' ? 'warn' : 'ok'}>{formatRisk(tool.riskLevel)}</ToneBadge></td><td><span className="mcp-table-muted">{tool.requiresApproval ? 'Approval required' : 'Auto run'}</span></td><td><span className={cn('mcp-schema-state', !tool.schemaSupported && 'unsupported')}>{tool.schemaSupported ? 'Supported' : 'Unsupported'}</span></td><td>{tool.isRemoved ? <ToneBadge tone="danger">Removed</ToneBadge> : <button type="button" className={cn('mcp-switch', tool.isEnabled && 'on')} role="switch" aria-checked={tool.isEnabled} aria-label={`${tool.remoteName} enabled`} disabled={busy} onClick={() => onToggle(tool)}><span /><span className="mcp-switch-label">{tool.isEnabled ? 'Enabled' : 'Disabled'}</span></button>}</td><td>{!tool.isRemoved && <button type="button" className="mcp-icon-button" onClick={() => onTest(tool)} title={`Test ${tool.remoteName}`} aria-label={`Test ${tool.remoteName}`}>{busy ? <LoaderCircle className="mcp-spin" size={14} /> : <Play size={14} />}</button>}</td></tr>
  })}</tbody></table></div>
}

function buildInitialEditor(server: McpServer | null): EditorFormState {
  if (!server) return { name: '', transportKind: 'stdio', command: '', args: '', cwd: '', envLines: '', url: '', headerLines: '' }
  if (server.transport.kind === 'stdio') return { name: server.name, transportKind: 'stdio', command: server.transport.command, args: server.transport.args.join('\n'), cwd: server.transport.cwd ?? '', envLines: server.transport.envNames.map((name) => `${name}=`).join('\n'), url: '', headerLines: '' }
  return { name: server.name, transportKind: 'streamable_http', command: '', args: '', cwd: '', envLines: '', url: server.transport.origin, headerLines: server.transport.headers.map((name) => `${name}=`).join('\n') }
}

function parseKeyValueLines(raw: string, options: { requireSecret: boolean; label: string }): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of raw.split('\n').map((entry) => entry.trim()).filter(Boolean)) {
    const separator = line.indexOf('=')
    if (separator <= 0) throw new Error(`${options.label} entries must use NAME=value.`)
    const name = line.slice(0, separator).trim(); const value = line.slice(separator + 1).trim()
    if (options.label === 'Environment' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`${name || 'Environment'} is not a valid environment name.`)
    if (!value) throw new Error(`${name} needs a value. Re-enter a secret reference if the value is sensitive.`)
    if (options.requireSecret && !SECRET_REFERENCE_PATTERN.test(value)) throw new Error(`${name} must use a ${'${env:NAME}'} secret reference.`)
    if (result[name] !== undefined) throw new Error(`${name} is duplicated.`)
    result[name] = value
  }
  return result
}

function buildConfig(form: EditorFormState): Record<string, JsonValue> {
  if (form.transportKind === 'stdio') {
    const command = form.command.trim(); if (!command) throw new Error('A stdio command is required.')
    const args = form.args.split('\n').map((value) => value.trim()).filter(Boolean)
    const env = parseKeyValueLines(form.envLines, { requireSecret: true, label: 'Environment' })
    return { command, args, ...(form.cwd.trim() ? { cwd: form.cwd.trim() } : {}), ...(Object.keys(env).length ? { env } : {}) }
  }
  const url = form.url.trim(); let parsed: URL
  try { parsed = new URL(url) } catch { throw new Error('Streamable HTTP URL must be a valid http(s) URL.') }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Streamable HTTP URL must use http or https.')
  return { url, headers: parseKeyValueLines(form.headerLines, { requireSecret: true, label: 'Header' }) }
}

function toJsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) { const entries = value.map(toJsonValue); return entries.every((entry): entry is JsonValue => entry !== undefined) ? entries : undefined }
  if (value && typeof value === 'object') { const result: Record<string, JsonValue> = {}; for (const [key, child] of Object.entries(value)) { const safe = toJsonValue(child); if (safe === undefined) return undefined; result[key] = safe } return result }
  return undefined
}

export function McpServerEditorModal({ server, onClose, onSave }: { server: McpServer | null; onClose: () => void; onSave: (input: McpServerConfigInput | McpServerPatch) => Promise<boolean> }) {
  const [form, setForm] = useState<EditorFormState>(() => buildInitialEditor(server))
  const [configDirty, setConfigDirty] = useState(!server)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const setField = <K extends keyof EditorFormState>(field: K, value: EditorFormState[K]) => { setForm((current) => ({ ...current, [field]: value })); if (field !== 'name') setConfigDirty(true); setValidationError(null) }
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault(); const name = form.name.trim(); if (!name) { setValidationError('A server name is required.'); return }
    try { const input: McpServerConfigInput | McpServerPatch = server && !configDirty ? { name } : { name, transportKind: form.transportKind, config: buildConfig(form) }; setSaving(true); const saved = await onSave(input); setSaving(false); if (saved) onClose() }
    catch (error) { setSaving(false); setValidationError(error instanceof Error ? error.message : 'The configuration is invalid.') }
  }
  const existingHiddenValues = server && (server.transport.kind === 'stdio' ? server.transport.envNames.length > 0 : server.transport.headers.length > 0)
  return <div className="mcp-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}><form className="mcp-modal" onSubmit={handleSubmit} aria-labelledby="mcp-editor-title">
    <div className="mcp-modal-head"><div><div className="mcp-eyebrow">MCP server configuration</div><h2 id="mcp-editor-title">{server ? 'Edit server' : 'Add server'}</h2></div><button type="button" className="mcp-icon-button" onClick={onClose} aria-label="Close"><X size={17} /></button></div>
    <div className="mcp-modal-body">
      <label className="mcp-field"><span>Server name</span><input value={form.name} onChange={(event) => setField('name', event.target.value)} autoFocus placeholder="Research MCP" /></label>
      <label className="mcp-field"><span>Transport</span><select value={form.transportKind} onChange={(event) => setField('transportKind', event.target.value as McpTransportKind)}><option value="stdio">stdio</option><option value="streamable_http">Streamable HTTP</option></select></label>
      {form.transportKind === 'stdio' ? <>
        <label className="mcp-field"><span>Command</span><input value={form.command} onChange={(event) => setField('command', event.target.value)} placeholder="node" /><small>Only the command summary is displayed later; resolved environment values never enter the UI.</small></label>
        <label className="mcp-field"><span>Arguments <em>one per line</em></span><textarea value={form.args} onChange={(event) => setField('args', event.target.value)} rows={4} placeholder={'server.mjs\n--mode\nsafe'} /></label>
        <label className="mcp-field"><span>Working directory <em>optional</em></span><input value={form.cwd} onChange={(event) => setField('cwd', event.target.value)} placeholder={'D:\\tools\\mcp'} /></label>
        <label className="mcp-field"><span>Environment <em>NAME=value, one per line</em></span><textarea value={form.envLines} onChange={(event) => setField('envLines', event.target.value)} rows={3} placeholder={'MCP_TOKEN=${env:MCP_TOKEN}'} />{existingHiddenValues && <small>Existing environment names are shown without values. Re-enter each value as a reference before saving transport changes.</small>}</label>
      </> : <>
        <label className="mcp-field"><span>Streamable HTTP URL</span><input value={form.url} onChange={(event) => setField('url', event.target.value)} placeholder="https://mcp.example.test/mcp" /><small>The server card shows only the URL origin.</small></label>
        <label className="mcp-field"><span>Headers <em>NAME=${'{env:NAME}'}, one per line</em></span><textarea value={form.headerLines} onChange={(event) => setField('headerLines', event.target.value)} rows={4} placeholder={'Authorization=${env:MCP_TOKEN}'} /><small>Header names are safe to display; header values must be secret references and are never displayed after saving.</small></label>
        {existingHiddenValues && <div className="mcp-security-note"><ShieldCheck size={14} /> Existing header names are shown without values. Re-enter references to change transport.</div>}
      </>}
      {validationError && <div className="mcp-message error" role="alert"><AlertCircle size={14} />{validationError}</div>}
      <div className="mcp-security-note"><ShieldCheck size={14} /> Resolved secrets are never stored in renderer state or sent back from the management API.</div>
    </div>
    <div className="mcp-modal-foot"><button type="button" className="mcp-button ghost" onClick={onClose}>Cancel</button><button type="submit" className="mcp-button primary" disabled={saving}><BusyLabel busy={saving} />{saving ? 'Saving…' : <><Save size={14} /> Save server</>}</button></div>
  </form></div>
}

function McpToolTestModal({ tool, onClose, onSubmit, busy }: { tool: McpTool; onClose: () => void; onSubmit: (input: JsonValue) => Promise<void>; busy: boolean }) {
  const [input, setInput] = useState('{}'); const [parseError, setParseError] = useState<string | null>(null)
  const submit = async (event: React.FormEvent) => { event.preventDefault(); try { const value = toJsonValue(JSON.parse(input) as unknown); if (value === undefined) throw new Error('Input must be a JSON value.'); setParseError(null); await onSubmit(value) } catch (error) { setParseError(error instanceof Error ? error.message : 'Input must be valid JSON.') } }
  return <div className="mcp-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}><form className="mcp-modal mcp-test-modal" onSubmit={submit} aria-labelledby="mcp-test-title">
    <div className="mcp-modal-head"><div><div className="mcp-eyebrow">Manual tool test</div><h2 id="mcp-test-title">{tool.remoteName}</h2></div><button type="button" className="mcp-icon-button" onClick={onClose} aria-label="Close"><X size={17} /></button></div>
    <div className="mcp-modal-body"><p className="mcp-muted">The request is evaluated by the server-side capability broker. Approval, risk and enablement policy cannot be overridden here.</p><label className="mcp-field"><span>JSON input</span><textarea value={input} onChange={(event) => setInput(event.target.value)} rows={9} spellCheck={false} className="mcp-code-input" /></label>{parseError && <div className="mcp-message error" role="alert"><AlertCircle size={14} />{parseError}</div>}</div>
    <div className="mcp-modal-foot"><button type="button" className="mcp-button ghost" onClick={onClose}>Cancel</button><button type="submit" className="mcp-button primary" disabled={busy}><BusyLabel busy={busy} />{busy ? 'Running…' : <><Play size={14} /> Test tool</>}</button></div>
  </form></div>
}

function PreviewDiffRow({ diff }: { diff: McpPreviewDiff }) {
  return <div className={cn('mcp-diff-row', diff.kind)}><div className="mcp-diff-kind">{diff.kind}</div><div className="mcp-diff-main"><strong>{diff.remoteName}</strong>{diff.toolId && <span>{diff.toolId}</span>}</div><div className="mcp-diff-values">{diff.before !== undefined && <pre>{jsonPreview(diff.before, 360)}</pre>}{diff.after !== undefined && <pre>{jsonPreview(diff.after, 360)}</pre>}</div></div>
}

function PreviewPanel({ preview, busy, onRefresh, onConfirm }: { preview: McpPreview | null; busy: boolean; onRefresh: () => void; onConfirm: () => void }) {
  const expired = preview ? isExpired(preview.expiresAt) : false
  return <section className="mcp-panel" aria-labelledby="mcp-preview-title"><div className="mcp-panel-head"><div><div className="mcp-eyebrow">Catalog governance</div><h2 id="mcp-preview-title"><FileDiff size={16} /> Preview and confirm</h2></div><button type="button" className="mcp-button ghost small" onClick={onRefresh} disabled={busy}><BusyLabel busy={busy} /><RefreshCw size={13} /> Refresh</button></div>
    {!preview ? <div className="mcp-empty-inline">Refresh to compare the remote catalog with the last confirmed version. New tools remain disabled until you confirm.</div> : <><div className="mcp-preview-meta"><span>Catalog v{preview.catalogVersion}</span><span>Created {formatDate(preview.createdAt)}</span><span className={expired ? 'mcp-danger-text' : ''}>{expired ? 'Expired' : `Expires ${formatDate(preview.expiresAt)}`}</span></div>{expired && <div className="mcp-message warning"><Clock3 size={14} /> This preview has expired. Refresh before confirming.</div>}<div className="mcp-diff-list">{preview.diff.length ? preview.diff.map((diff, index) => <PreviewDiffRow key={`${diff.remoteName}-${index}`} diff={diff} />) : <div className="mcp-empty-inline">No catalog changes detected.</div>}</div><div className="mcp-panel-foot"><span className="mcp-muted">Preview hash {preview.previewHash.slice(0, 12)}…</span><button type="button" className="mcp-button primary" onClick={onConfirm} disabled={busy || expired}><BusyLabel busy={busy} /><CheckCircle2 size={14} /> Confirm catalog</button></div></>}
  </section>
}

function ApprovalPanel({ approval, busy, onApprove, onDeny }: { approval: McpApprovalState; busy: boolean; onApprove: () => void; onDeny: () => void }) {
  return <section className="mcp-panel approval" aria-labelledby="mcp-approval-title"><div className="mcp-panel-head"><div><div className="mcp-eyebrow">Server-side policy</div><h2 id="mcp-approval-title"><ShieldCheck size={16} /> Approval required</h2></div><ToneBadge tone={isExpired(approval.expiresAt) ? 'danger' : 'warn'}>{isExpired(approval.expiresAt) ? 'Expired' : 'Pending'}</ToneBadge></div>
    <div className="mcp-approval-grid"><div><span>Request</span><strong>{approval.approvalRequestId}</strong></div><div><span>Run</span><strong>{approval.runId}</strong></div>{approval.safePreview.remoteName && <div><span>Tool</span><strong>{approval.safePreview.remoteName}</strong></div>}{approval.safePreview.riskLevel && <div><span>Risk</span><strong>{formatRisk(approval.safePreview.riskLevel)}</strong></div>}{approval.safePreview.trustLevel && <div><span>Trust</span><strong>{formatStatus(approval.safePreview.trustLevel)}</strong></div>}<div><span>Expires</span><strong>{formatDate(approval.expiresAt)}</strong></div></div>
    {approval.safePreview.safeInput !== undefined && <div className="mcp-safe-preview"><span>Safe input preview</span><pre>{jsonPreview(approval.safePreview.safeInput)}</pre></div>}
    <div className="mcp-panel-foot"><span className="mcp-muted">Approving re-reads server policy and consumes the one-time request on the server.</span><div className="mcp-inline-actions"><button type="button" className="mcp-button ghost danger-text" onClick={onDeny} disabled={busy}><Ban size={14} /> Deny</button><button type="button" className="mcp-button primary" onClick={onApprove} disabled={busy || isExpired(approval.expiresAt)}><BusyLabel busy={busy} /><ShieldCheck size={14} /> Approve</button></div></div>
  </section>
}

function RunResultPanel({ lastTest }: { lastTest: McpServersState['lastTest'] }) {
  if (!lastTest) return null
  const result = lastTest.result as McpSafeResult | undefined
  const run = lastTest.run
  const tone = statusTone(lastTest.status)
  return <section className="mcp-panel" aria-labelledby="mcp-result-title">
    <div className="mcp-panel-head"><div><div className="mcp-eyebrow">Manual test result</div><h2 id="mcp-result-title"><Activity size={16} /> Latest run</h2></div><ToneBadge tone={tone}>{formatStatus(lastTest.status)}</ToneBadge></div>
    <div className="mcp-run-summary">
      <div><span>Run ID</span><strong>{run?.id ?? '—'}</strong></div>
      <div><span>Tool</span><strong>{run?.remoteName ?? '—'}</strong></div>
      <div><span>Duration</span><strong>{run?.durationMs === null || run?.durationMs === undefined ? '—' : `${run.durationMs} ms`}</strong></div>
      <div><span>Completed</span><strong>{formatDate(run?.completedAt ?? run?.createdAt)}</strong></div>
    </div>
    {run?.errorCode && <div className="mcp-message error"><AlertCircle size={14} /> {run.errorCode}</div>}
    {result && <div className="mcp-safe-result"><div className="mcp-safe-result-head"><span>Safe result</span>{result.isError && <ToneBadge tone="danger">Remote error</ToneBadge>}</div>{result.safeSummary && <p>{result.safeSummary}</p>}<pre>{jsonPreview({ contentItems: result.content.length, structuredContent: result.structuredContent, truncated: result.truncated }, 960)}</pre></div>}
  </section>
}

function RunsTable({ runs }: { runs: McpRun[] }) {
  if (!runs.length) return <div className="mcp-empty-inline">No audited runs for this server yet.</div>
  return <div className="mcp-table-wrap"><table className="mcp-table mcp-runs-table"><caption className="sr-only">MCP server runs</caption><thead><tr><th>Created</th><th>Tool</th><th>Status</th><th>Role / Session</th><th>Duration</th><th>Safe output</th></tr></thead><tbody>{runs.map((run) => {
    const output = run.safeOutput
    return <tr key={run.id}><td>{formatDate(run.createdAt)}</td><td><div className="mcp-tool-name">{run.remoteName}</div><div className="mcp-table-muted">{run.id}</div></td><td><ToneBadge tone={statusTone(run.status)}>{formatStatus(run.status)}</ToneBadge>{run.errorCode && <div className="mcp-table-muted">{run.errorCode}</div>}</td><td><div>{run.agentRole || '—'}</div><div className="mcp-table-muted">{run.sessionId || '—'}</div></td><td>{run.durationMs === null || run.durationMs === undefined ? '—' : `${run.durationMs} ms`}</td><td>{output ? <span title={output.safeSummary || undefined}>{output.safeSummary || `${output.content.length} content item(s)${output.truncated ? ' · truncated' : ''}`}</span> : '—'}</td></tr>
  })}</tbody></table></div>
}

function ConnectionTestPanel({ tools }: { tools: McpDiscoveredTool[] | null }) {
  if (!tools) return null
  return <section className="mcp-panel" aria-labelledby="mcp-connection-test-title"><div className="mcp-panel-head"><div><div className="mcp-eyebrow">Temporary discovery</div><h2 id="mcp-connection-test-title"><Wrench size={16} /> Connection test</h2></div><ToneBadge tone="ok">{tools.length} discovered</ToneBadge></div>
    <p className="mcp-muted">Discovery results are not active tools. Refresh and Confirm are required before any catalog entry can be used by an Agent.</p>
    {!tools.length ? <div className="mcp-empty-inline">The connection succeeded, but the server advertised no tools.</div> : <div className="mcp-discovered-list">{tools.map((tool, index) => <div className="mcp-discovered-row" key={`${tool.toolId ?? tool.remoteName}-${index}`}><div><strong>{tool.remoteName}</strong><span>{tool.description || 'No description'}</span></div><div>{tool.schemaSupported === false ? <ToneBadge tone="danger">Schema unsupported</ToneBadge> : <ToneBadge tone="ok">Schema available</ToneBadge>}</div></div>)}</div>}
  </section>
}

function McpServerDetails({
  server,
  tools,
  runs,
  preview,
  connectionTest,
  pendingApproval,
  lastTest,
  loading,
  busyAction,
  onEdit,
  onDelete,
  onTestConnection,
  onRefreshPreview,
  onConfirmPreview,
  onSetEnabled,
  onSetTrust,
  onToggleTool,
  onTestTool,
  onApprove,
  onDeny,
}: {
  server: McpServer
  tools: McpTool[]
  runs: McpRun[]
  preview: McpPreview | null
  connectionTest: McpDiscoveredTool[] | null
  pendingApproval: McpApprovalState | null
  lastTest: McpServersState['lastTest']
  loading: boolean
  busyAction: string | null
  onEdit: () => void
  onDelete: () => void
  onTestConnection: () => void
  onRefreshPreview: () => void
  onConfirmPreview: () => void
  onSetEnabled: (enabled: boolean) => void
  onSetTrust: (level: McpServer['trustLevel']) => void
  onToggleTool: (tool: McpTool) => void
  onTestTool: (tool: McpTool) => void
  onApprove: () => void
  onDeny: () => void
}) {
  const busy = Boolean(busyAction)
  const currentToolCount = tools.filter((tool) => !tool.isRemoved).length
  return <div className="mcp-details">
    <header className="mcp-details-header"><div className="mcp-details-title"><div className="mcp-server-card-icon large"><Server size={21} /></div><div><div className="mcp-eyebrow">MCP server</div><h1>{server.name}</h1><p>{transportLabel(server)} · {transportSummary(server)}</p></div></div><div className="mcp-header-actions"><button type="button" className="mcp-button ghost" onClick={onEdit} disabled={busy}><Pencil size={14} /> Edit</button><button type="button" className="mcp-button ghost danger-text" onClick={onDelete} disabled={busy}><Trash2 size={14} /> Delete</button></div></header>
    <div className="mcp-server-facts"><div><span>Connection</span><strong><i className={cn('mcp-status-dot', statusTone(server.connectionStatus))} />{formatStatus(server.connectionStatus)}</strong></div><div><span>Trust level</span><select value={server.trustLevel} onChange={(event) => onSetTrust(event.target.value as McpServer['trustLevel'])} disabled={busy}><option value="untrusted">Untrusted</option><option value="reviewed">Reviewed</option><option value="trusted">Trusted</option></select></div><div><span>Catalog</span><strong>v{server.catalogVersion}</strong></div><div><span>Confirmed tools</span><strong>{currentToolCount}</strong></div><div><span>Enabled</span><strong>{server.isEnabled ? 'Yes' : 'No'}</strong></div></div>
    <div className="mcp-details-actions"><button type="button" className="mcp-button primary" onClick={onTestConnection} disabled={busy}><BusyLabel busy={busyAction === 'test-connection'} /><RefreshCw size={14} /> Test connection</button><button type="button" className="mcp-button ghost" onClick={onRefreshPreview} disabled={busy}><BusyLabel busy={busyAction === 'refresh-preview'} /><FileDiff size={14} /> Refresh Preview</button><button type="button" className={cn('mcp-button', server.isEnabled ? 'ghost danger-text' : 'ghost')} onClick={() => onSetEnabled(!server.isEnabled)} disabled={busy}><BusyLabel busy={busyAction === 'enable-server' || busyAction === 'disable-server'} />{server.isEnabled ? <Ban size={14} /> : <CheckCircle2 size={14} />}{server.isEnabled ? 'Disable server' : 'Enable server'}</button></div>
    {server.lastErrorCode && <div className="mcp-message warning"><AlertCircle size={14} /> Last connection error: {server.lastErrorCode} · {formatDate(server.lastErrorAt)}</div>}
    <ConnectionTestPanel tools={connectionTest} />
    <PreviewPanel preview={preview} busy={busyAction === 'refresh-preview' || busyAction === 'confirm-preview'} onRefresh={onRefreshPreview} onConfirm={onConfirmPreview} />
    {pendingApproval && <ApprovalPanel approval={pendingApproval} busy={busyAction === 'approve' || busyAction === 'deny'} onApprove={onApprove} onDeny={onDeny} />}
    <RunResultPanel lastTest={lastTest} />
    <section className="mcp-panel" aria-labelledby="mcp-tools-title"><div className="mcp-panel-head"><div><div className="mcp-eyebrow">Confirmed catalog</div><h2 id="mcp-tools-title"><Wrench size={16} /> Tool policy</h2></div><span className="mcp-muted">{tools.length} record{tools.length === 1 ? '' : 's'} including removed history</span></div><McpToolPolicyTable tools={tools} busyToolId={busyAction?.startsWith('tool:') ? busyAction.slice(5) : null} onToggle={onToggleTool} onTest={onTestTool} /></section>
    <section className="mcp-panel" aria-labelledby="mcp-runs-title"><div className="mcp-panel-head"><div><div className="mcp-eyebrow">Audit trail</div><h2 id="mcp-runs-title"><Activity size={16} /> Runs</h2></div><span className="mcp-muted">Latest {runs.length}</span></div><RunsTable runs={runs} /></section>
    {loading && <div className="mcp-loading-overlay" role="status"><LoaderCircle className="mcp-spin" size={18} /> Loading server state…</div>}
  </div>
}

function DisabledState() {
  return <div className="mcp-page mcp-disabled-state" role="status"><div className="mcp-disabled-icon"><ShieldCheck size={28} /></div><div><div className="mcp-eyebrow">Safety gate</div><h1>MCP client is disabled</h1><p>The server feature flag <code>MCP_CLIENT_ENABLED</code> is not enabled. Management and execution controls are hidden until an administrator enables the MCP client.</p></div></div>
}

function ConfirmDeleteModal({ server, busy, onClose, onConfirm }: { server: McpServer; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  return <div className="mcp-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}><div className="mcp-modal compact" role="dialog" aria-modal="true" aria-labelledby="mcp-delete-title"><div className="mcp-modal-head"><div><div className="mcp-eyebrow">Remove server</div><h2 id="mcp-delete-title">Delete {server.name}?</h2></div><button type="button" className="mcp-icon-button" onClick={onClose} aria-label="Close"><X size={17} /></button></div><div className="mcp-modal-body"><p>This removes the server configuration from management. Historical run audit records remain server-side according to the retention policy.</p><div className="mcp-message warning"><AlertCircle size={14} /> This action cannot be undone from the UI.</div></div><div className="mcp-modal-foot"><button type="button" className="mcp-button ghost" onClick={onClose}>Cancel</button><button type="button" className="mcp-button danger" onClick={onConfirm} disabled={busy}><BusyLabel busy={busy} /><Trash2 size={14} /> Delete server</button></div></div></div>
}

export function McpServersPage() {
  const {
    servers, selectedServerId, tools, toolCounts, runs, preview, connectionTest, pendingApproval, lastTest,
    featureDisabled, loading, busyAction, error, loadServers, selectServer, loadServerDetails,
    createServer, updateServer, deleteServer, testConnection, refreshPreview, confirmPreview,
    setServerEnabled, setServerTrust, setToolEnabled, runToolTest, approvePending, denyPending, clearError,
  } = useMcpServersStore()
  const liveFeatureDisabled = useMcpServersStore.getState().featureDisabled || featureDisabled
  const [editorServer, setEditorServer] = useState<McpServer | null | undefined>(undefined)
  const [deleteTarget, setDeleteTarget] = useState<McpServer | null>(null)
  const [toolToTest, setToolToTest] = useState<McpTool | null>(null)

  useEffect(() => {
    if (!liveFeatureDisabled) void loadServers()
  }, [liveFeatureDisabled, loadServers])

  if (liveFeatureDisabled) return <DisabledState />
  const selectedServer = servers.find((server) => server.id === selectedServerId) ?? null
  const isBusy = Boolean(busyAction)
  const selectedToolCount = tools.filter((tool) => !tool.isRemoved).length
  const handleSave = async (input: McpServerConfigInput | McpServerPatch): Promise<boolean> => {
    if (editorServer) return Boolean(await updateServer(editorServer.id, input))
    const created = await createServer(input as McpServerConfigInput)
    if (created) await loadServerDetails(created.id)
    return Boolean(created)
  }
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    await deleteServer(deleteTarget.id)
    if (!useMcpServersStore.getState().error) setDeleteTarget(null)
  }
  const handleToolTest = async (input: JsonValue) => {
    if (!toolToTest) return
    await runToolTest(toolToTest.id, input)
    const state = useMcpServersStore.getState()
    if (state.lastTest || state.pendingApproval) setToolToTest(null)
  }
  return <div className="mcp-page">
    <header className="mcp-page-header"><div><div className="mcp-eyebrow">Integrations</div><h1>MCP Servers</h1><p>Manage trusted remote tool catalogs through the BloomAI capability broker.</p></div><button type="button" className="mcp-button primary" onClick={() => setEditorServer(null)} disabled={isBusy}><Plus size={14} /> Add server</button></header>
    {error && <div className="mcp-message error" role="alert"><AlertCircle size={14} /><span>{uiErrorMessage(error.code, error.message)}</span><button type="button" className="mcp-message-close" onClick={clearError} aria-label="Dismiss error"><X size={14} /></button></div>}
    <div className="mcp-layout">
      <aside className="mcp-server-list" aria-label="MCP servers"><div className="mcp-list-head"><div><strong>Servers</strong><span>{servers.length} configured</span></div><button type="button" className="mcp-icon-button" onClick={() => void loadServers()} disabled={isBusy || loading} aria-label="Reload servers" title="Reload servers"><RefreshCw className={cn(loading && 'mcp-spin')} size={15} /></button></div>{loading && !servers.length ? <div className="mcp-list-loading" role="status"><LoaderCircle className="mcp-spin" size={17} /> Loading servers…</div> : servers.length ? servers.map((server) => <McpServerCard key={server.id} server={server} toolCount={toolCounts[server.id] ?? (server.id === selectedServerId ? selectedToolCount : undefined)} selected={server.id === selectedServerId} onSelect={() => void selectServer(server.id)} />) : <div className="mcp-empty-state"><Server size={24} /><strong>No MCP servers</strong><p>Add a server to start a reviewed catalog.</p><button type="button" className="mcp-button ghost small" onClick={() => setEditorServer(null)} disabled={isBusy}><Plus size={13} /> Add server</button></div>}</aside>
      <main className="mcp-main" aria-live="polite">{selectedServer ? <McpServerDetails server={selectedServer} tools={tools} runs={runs} preview={preview} connectionTest={connectionTest} pendingApproval={pendingApproval} lastTest={lastTest} loading={loading} busyAction={busyAction} onEdit={() => setEditorServer(selectedServer)} onDelete={() => setDeleteTarget(selectedServer)} onTestConnection={() => void testConnection(selectedServer.id)} onRefreshPreview={() => void refreshPreview(selectedServer.id)} onConfirmPreview={() => void confirmPreview()} onSetEnabled={(enabled) => void setServerEnabled(selectedServer.id, enabled)} onSetTrust={(level) => void setServerTrust(selectedServer.id, level)} onToggleTool={(tool) => void setToolEnabled(tool.id, !tool.isEnabled)} onTestTool={setToolToTest} onApprove={() => void approvePending()} onDeny={() => void denyPending()} /> : <div className="mcp-empty-detail"><Server size={30} /><h2>{servers.length ? 'Select an MCP server' : 'No server selected'}</h2><p>Server details, catalog preview, approvals and audit runs will appear here.</p></div>}</main>
    </div>
    {editorServer !== undefined && <McpServerEditorModal server={editorServer} onClose={() => setEditorServer(undefined)} onSave={handleSave} />}
    {deleteTarget && <ConfirmDeleteModal server={deleteTarget} busy={busyAction === 'delete-server'} onClose={() => setDeleteTarget(null)} onConfirm={() => void handleConfirmDelete()} />}
    {toolToTest && <McpToolTestModal tool={toolToTest} busy={busyAction === `test:${toolToTest.id}`} onClose={() => setToolToTest(null)} onSubmit={handleToolTest} />}
  </div>
}

export { McpServerDetails, ConnectionTestPanel, RunsTable, RunResultPanel }
