import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmVideoTaskRecord } from '../../db/repositories/llm.repo'

let dataDir: string
let originalEnv: NodeJS.ProcessEnv
let originalFetch: typeof globalThis.fetch

async function loadRuntime() {
  vi.resetModules()
  process.env.DATA_DIR = dataDir

  const client = await import('../../db/client')
  await client.runMigrations()
  const { llmRepo } = await import('../../db/repositories/llm.repo')
  const video = await import('./video')

  return { db: client.db, llmRepo, video }
}

function providerResponse(body: object): Response {
  return Response.json(body)
}

describe('Agnes video runtime', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-video-runtime-'))
    originalEnv = { ...process.env }
    originalFetch = globalThis.fetch
    process.env.AGNES_API_KEY = 'test-agnes-key'
  })

  afterEach(() => {
    vi.resetModules()
    process.env = originalEnv
    globalThis.fetch = originalFetch
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('creates a local Agnes video task and sends the expected request body', async () => {
    const fetchMock = vi.fn(async () => providerResponse({ task_id: 'provider-task-1', video_id: 'video-1', status: 'queued' }))
    globalThis.fetch = fetchMock as typeof fetch

    const { llmRepo, video } = await loadRuntime()

    const result = await video.createVideoTask({
      model: 'agnes-video-v2.0',
      prompt: 'A slow camera push through glass flowers',
      image: ['https://example.com/input.png'],
      width: 1280,
      height: 720,
      numFrames: 96,
      frameRate: 24,
      seed: 42,
      negativePrompt: 'blur',
    })

    expect(result).toMatchObject({
      providerId: 'agnes',
      model: 'agnes-video-v2.0',
      videoId: 'video-1',
      status: 'queued',
    })
    expect(llmRepo.getVideoTask(result.taskId)).toMatchObject({
      provider_id: 'agnes',
      model: 'agnes-video-v2.0',
      provider_task_id: 'provider-task-1',
      provider_video_id: 'video-1',
      status: 'queued',
    })
    expect(fetchMock).toHaveBeenCalledWith('https://apihub.agnes-ai.com/v1/videos', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-agnes-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'agnes-video-v2.0',
        prompt: 'A slow camera push through glass flowers',
        image: ['https://example.com/input.png'],
        width: 1280,
        height: 720,
        num_frames: 96,
        frame_rate: 24,
        seed: 42,
        negative_prompt: 'blur',
      }),
    })
  })

  it.each([
    ['queued', 'queued', 0],
    ['processing', 'in_progress', 45],
    ['in_progress', 'in_progress', 60],
    ['failed', 'failed', 100],
  ] as const)('maps Agnes query status %s to %s', async (providerStatus, expectedStatus, progress) => {
    const fetchMock = vi.fn(async () => providerResponse({
      status: providerStatus,
      progress,
      error: providerStatus === 'failed' ? 'render failed' : undefined,
    }))
    globalThis.fetch = fetchMock as typeof fetch

    const { llmRepo, video } = await loadRuntime()
    const task = llmRepo.createVideoTask({
      providerId: 'agnes',
      model: 'agnes-video-v2.0',
      providerTaskId: 'provider-task-1',
      providerVideoId: 'video-1',
      input: { prompt: 'query me' },
      status: 'queued',
    })

    const result = await video.getAgnesVideoTask(task)

    expect(result).toMatchObject({
      taskId: task.id,
      videoId: 'video-1',
      providerId: 'agnes',
      model: 'agnes-video-v2.0',
      status: expectedStatus,
      progress,
    })
    expect(llmRepo.getVideoTask(task.id)?.status).toBe(expectedStatus)
    expect(fetchMock).toHaveBeenCalledWith('https://apihub.agnes-ai.com/agnesapi?video_id=video-1', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer test-agnes-key',
      },
    })
  })

  it('maps completed Agnes video URL from remixed_from_video_id', async () => {
    globalThis.fetch = vi.fn(async () => providerResponse({
      status: 'completed',
      progress: 100,
      remixed_from_video_id: 'https://cdn.example/video.mp4',
    })) as typeof fetch

    const { llmRepo, video } = await loadRuntime()
    const task = llmRepo.createVideoTask({
      providerId: 'agnes',
      model: 'agnes-video-v2.0',
      providerTaskId: 'provider-task-1',
      providerVideoId: 'video-1',
      input: { prompt: 'complete me' },
      status: 'in_progress',
    })

    const result = await video.getVideoTask(task.id)

    expect(result).toEqual({
      taskId: task.id,
      videoId: 'video-1',
      providerId: 'agnes',
      model: 'agnes-video-v2.0',
      status: 'completed',
      progress: 100,
      url: 'https://cdn.example/video.mp4',
    })
    expect(JSON.parse(llmRepo.getVideoTask(task.id)?.output_json || '{}')).toEqual({
      url: 'https://cdn.example/video.mp4',
      raw: {
        status: 'completed',
        progress: 100,
        remixed_from_video_id: 'https://cdn.example/video.mp4',
      },
    })
  })

  it('returns stored failed tasks without querying Agnes again', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as typeof fetch

    const { llmRepo, video } = await loadRuntime()
    const task = llmRepo.createVideoTask({
      providerId: 'agnes',
      model: 'agnes-video-v2.0',
      providerTaskId: 'provider-task-1',
      providerVideoId: 'video-1',
      input: { prompt: 'failed' },
      status: 'failed',
      error: 'already failed',
    }) as LlmVideoTaskRecord

    await expect(video.getVideoTask(task.id)).resolves.toMatchObject({
      taskId: task.id,
      status: 'failed',
      error: 'already failed',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
