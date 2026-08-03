import { describe, expect, it } from 'vitest'
import {
  canSendProjectWorkspaceTask,
  isProjectWorkspaceUnavailableError,
  shouldRenderProjectWorkspaceContext,
} from './ProjectWorkspaceContext'

describe('project workspace availability helpers', () => {
  it('recognizes the stable server error and blocks only unavailable project sessions', () => {
    expect(isProjectWorkspaceUnavailableError(new Error('PROJECT_WORKSPACE_UNAVAILABLE'))).toBe(true)
    expect(isProjectWorkspaceUnavailableError(new Error('项目工作目录不可用'))).toBe(true)
    expect(isProjectWorkspaceUnavailableError(new Error('network timeout'))).toBe(false)

    expect(canSendProjectWorkspaceTask(null, { 'project-1': true })).toBe(true)
    expect(canSendProjectWorkspaceTask('project-1', { 'project-1': true })).toBe(false)
    expect(canSendProjectWorkspaceTask('project-2', { 'project-1': true })).toBe(true)
  })

  it('renders workspace context only for a session owned by a project', () => {
    expect(shouldRenderProjectWorkspaceContext(null)).toBe(false)
    expect(shouldRenderProjectWorkspaceContext(undefined)).toBe(false)
    expect(shouldRenderProjectWorkspaceContext('project-1')).toBe(true)
  })
})
