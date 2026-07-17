import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  buildResearchRunAssistantMessage,
  chatAgentHeaderForTab,
  isDeepResearchWorkbenchActive,
  isChatComposerVisible,
  restoreParts,
} from '../ChatPanelMastra'
import { ResearchRunPart } from './ResearchRunPart'
import { slimParts } from '../parts/tool-part'

describe('Deep Research Chat routing', () => {
  it('routes the enabled Research tab to the durable workbench without a legacy agent header', () => {
    expect(isDeepResearchWorkbenchActive('research')).toBe(true)
    expect(chatAgentHeaderForTab('research')).toBe('')
    expect(isChatComposerVisible('research')).toBe(false)
  })

  it('keeps non-research tabs on their dedicated chat agents', () => {
    expect(chatAgentHeaderForTab('writing')).toBe('writing')
    expect(chatAgentHeaderForTab('coding')).toBe('coding')
    expect(chatAgentHeaderForTab('')).toBe('')
  })

  it('persists, reloads, renders, and opens a compact research-run part without report text', () => {
    const data = { runId: 'run-7', title: 'Market map', status: 'researching', artifactId: 'artifact-7' }
    const saved = buildResearchRunAssistantMessage(data)
    const reloaded = restoreParts({ content: saved.content, parts: JSON.stringify(saved.parts) })
    const openRun = vi.fn()
    const element = ResearchRunPart({ data: reloaded[0].data, onOpen: openRun })

    expect(slimParts([{ type: 'data-research-run', data }])).toEqual(saved.parts)
    expect(saved.content).toBe('')
    expect(renderToStaticMarkup(element)).toContain('Market map')
    expect(renderToStaticMarkup(element)).toContain('run-7')
    ;(element.props as { onClick: () => void }).onClick()
    expect(openRun).toHaveBeenCalledWith('run-7')
  })

  it('keeps historical workflow parts intact after reload', () => {
    const parts = [{ type: 'data-workflow', data: { workflowId: 'deep-research', steps: [] } }]
    expect(restoreParts({ content: '', parts: JSON.stringify(slimParts(parts)) })).toEqual(parts)
  })
})
