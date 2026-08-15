import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const globalCss = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8')

const neutralControlStates = '.mcp-field input:hover, .mcp-field textarea:hover, .mcp-field select:hover, .mcp-field input:focus, .mcp-field textarea:focus, .mcp-field select:focus, .mcp-field input:focus-visible, .mcp-field textarea:focus-visible, .mcp-field select:focus-visible, .mcp-field input:active, .mcp-field textarea:active, .mcp-field select:active'

describe('MCP editor control styling', () => {
  it('keeps editor input, select, and textarea hover and focus states neutral', () => {
    expect(globalCss).toContain(neutralControlStates)
    expect(globalCss).toContain(`${neutralControlStates} { border-color: var(--border-secondary); background: var(--bg-primary); box-shadow: none; outline: none; }`)
  })
})