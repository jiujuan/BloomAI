import { describe, expect, it } from 'vitest'
import { runAgentBrowserPoc } from '../../../../scripts/verify-web-tools-agent-browser'

const enabled = process.env.BLOOMAI_WEB_BROWSER_INTEGRATION === '1'

describe('Agent Browser real browser POC', () => {
  it.skipIf(!enabled)('hydrates the fixture, captures PNG, blocks unsafe subresources, and cleans up aborts', async () => {
    const result = await runAgentBrowserPoc()

    expect(result.agentBrowserApiUsed).toBe(true)
    expect(result.managerReadHydrated).toBe(true)
    expect(result.screenshotSource).toBe('agent_browser')
    expect(result.hydrated).toBe(true)
    expect(result.screenshot.bytes).toBeGreaterThan(0)
    expect(result.screenshot.width).toBe(1024)
    expect(result.screenshot.height).toBeGreaterThan(0)
    expect(result.blockedRequests).toBeGreaterThanOrEqual(1)
    expect(result.abortCode).toBe('WEB_BROWSER_ABORTED')
    expect(result.contextsAfterAbort).toBe(0)
    expect(result.browserClosed).toBe(true)
  })
})
