import { describe, expect, it, vi } from 'vitest'
import { shutdownMastraRuntime } from './index'

describe('shutdownMastraRuntime', () => {
  it('shuts down Mastra, cached project workspaces, and runtime storage in order', async () => {
    const mastra = { shutdown: vi.fn().mockResolvedValue(undefined) }
    const projectWorkspaceFactory = { shutdown: vi.fn().mockResolvedValue(undefined) }
    const scheduleRuntimeStorage = { close: vi.fn().mockResolvedValue(undefined) }

    await shutdownMastraRuntime({ mastra, projectWorkspaceFactory, scheduleRuntimeStorage } as any)

    expect(mastra.shutdown).toHaveBeenCalledOnce()
    expect(projectWorkspaceFactory.shutdown).toHaveBeenCalledOnce()
    expect(scheduleRuntimeStorage.close).toHaveBeenCalledOnce()
    expect(mastra.shutdown.mock.invocationCallOrder[0]).toBeLessThan(projectWorkspaceFactory.shutdown.mock.invocationCallOrder[0])
    expect(projectWorkspaceFactory.shutdown.mock.invocationCallOrder[0]).toBeLessThan(scheduleRuntimeStorage.close.mock.invocationCallOrder[0])
  })
})
