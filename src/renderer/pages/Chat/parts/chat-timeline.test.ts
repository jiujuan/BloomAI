import { describe, expect, it } from 'vitest'
import {
  activityLabelForTool,
  activityStatusLabel,
  buildAssistantTurnModel,
  defaultActivityOpen,
  shouldShowWhenSummaryCollapsed,
} from './chat-timeline'

const tool = (name: string, state = 'output-available', output?: unknown) => ({
  type: `tool-${name}`,
  toolCallId: `${name}-1`,
  state,
  input: { path: 'src/example.ts' },
  output,
})

describe('buildAssistantTurnModel', () => {
  it('separates final text from work activities', () => {
    const result = buildAssistantTurnModel([
      { type: 'reasoning', text: '先检查文件', state: 'done' },
      tool('fs_read'),
      { type: 'text', text: '检查完成。' },
    ])

    expect(result.activities).toHaveLength(2)
    expect(result.activities[0]).toMatchObject({ kind: 'reasoning', label: '思考过程', expandable: true })
    expect(result.activities[1]).toMatchObject({ kind: 'tool', label: '读取文件', expandable: true })
    expect(result.answerParts).toEqual([{ type: 'text', text: '检查完成。' }])
  })

  it('groups only adjacent tool calls with the same semantic name', () => {
    const result = buildAssistantTurnModel([tool('shell_run'), tool('shell_run'), tool('fs_read'), tool('shell_run')])

    expect(result.activities.filter((item) => item.kind === 'tool')).toHaveLength(3)
    expect(result.activities[0].parts).toHaveLength(2)
    expect(result.activities[1].parts).toHaveLength(1)
    expect(result.activities[2].parts).toHaveLength(1)
  })

  it('does not create a fake activity for plain text or unknown non-renderable parts', () => {
    const result = buildAssistantTurnModel([
      { type: 'text', text: '只有答案。' },
      { type: 'step-start' },
      { type: 'data-context-compacted' },
    ])

    expect(result.activities).toEqual([])
    expect(result.answerParts).toEqual([{ type: 'text', text: '只有答案。' }])
  })

  it('keeps approval, running and error activities critical', () => {
    const result = buildAssistantTurnModel([
      { type: 'data-tool-call-approval', data: { runId: 'r', toolCallId: 't', toolName: 'shell_run', args: { command: 'npm test' } } },
      { type: 'data-error', data: { title: '请求失败', message: '模型配置错误' } },
      tool('shell_run', 'input-available'),
    ])

    expect(result.activities.map((item) => item.critical)).toEqual([true, true, true])
    expect(result.activities.map((item) => item.status)).toEqual(['permission', 'error', 'running'])
  })

  it('does not show an empty summary for a legacy text-only assistant message', () => {
    expect(buildAssistantTurnModel([{ type: 'text', text: '旧回答' }])).toEqual({
      activities: [],
      answerParts: [{ type: 'text', text: '旧回答' }],
    })
  })
})

describe('timeline labels and defaults', () => {
  it('uses Chinese labels for known tools', () => {
    expect(activityLabelForTool('fs_read')).toBe('读取文件')
    expect(activityLabelForTool('shell_run')).toBe('运行命令')
    expect(activityLabelForTool('web_search')).toBe('搜索资料')
  })

  it('only shows a status label for non-success activity states', () => {
    expect(activityStatusLabel('success')).toBe('')
    expect(activityStatusLabel('error')).toBe('失败')
  })

  it('keeps critical activities open by default', () => {
    expect(defaultActivityOpen({ status: 'running', critical: true }, { streaming: true, historical: false })).toBe(true)
    expect(defaultActivityOpen({ status: 'permission', critical: true }, { streaming: false, historical: true })).toBe(true)
    expect(defaultActivityOpen({ status: 'success', critical: false }, { streaming: false, historical: true })).toBe(false)
  })

  it('hides failed activities when the work summary is collapsed', () => {
    expect(shouldShowWhenSummaryCollapsed({ status: 'error', critical: true })).toBe(false)
    expect(shouldShowWhenSummaryCollapsed({ status: 'running', critical: true })).toBe(true)
    expect(shouldShowWhenSummaryCollapsed({ status: 'permission', critical: true })).toBe(true)
  })
})
