import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ServiceError } from '../../services/errors'
import { createHttpErrorHandler } from '../error-mapper'

const attachmentServiceMock = vi.hoisted(() => ({
  saveUploadedAttachment: vi.fn(),
}))

vi.mock('../../services/attachment.service', () => ({ attachmentService: attachmentServiceMock }))

import { attachmentsRoutes } from './attachments'

function createApp() {
  const app = new Hono()
  app.onError(createHttpErrorHandler(() => undefined))
  return app.route('/api/v1/attachments', attachmentsRoutes)
}

function uploadRequest(name = 'notes.txt', content = 'attachment text') {
  const form = new FormData()
  form.append('file', new File([content], name, { type: 'text/plain' }))
  return new Request('http://localhost/api/v1/attachments', { method: 'POST', body: form })
}

describe('Attachment upload route contract', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('parses multipart input and delegates each attachment to the service', async () => {
    attachmentServiceMock.saveUploadedAttachment.mockReturnValue({
      id: 'attachment-1', name: 'notes.txt', ext: 'txt', size: 15, path: 'C:/safe/notes.txt', uploadedAt: 1,
    })

    const response = await createApp().fetch(uploadRequest())

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ data: [expect.objectContaining({ id: 'attachment-1', name: 'notes.txt' })] })
    expect(attachmentServiceMock.saveUploadedAttachment).toHaveBeenCalledWith({
      name: 'notes.txt',
      buffer: expect.any(Buffer),
    })
    expect(attachmentServiceMock.saveUploadedAttachment.mock.calls[0][0].buffer.toString()).toBe('attachment text')
  })

  it('preserves the service validation error envelope for a rejected upload', async () => {
    attachmentServiceMock.saveUploadedAttachment.mockImplementation(() => {
      throw new ServiceError('VALIDATION_ERROR', 'Unsupported attachment type')
    })

    const response = await createApp().fetch(uploadRequest('unsafe.exe', 'x'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Unsupported attachment type' },
    })
  })

  it('keeps multipart and required-file validation in the HTTP route', async () => {
    const response = await createApp().request('/api/v1/attachments', { method: 'POST' })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'VALIDATION_ERROR', message: '\u7f3a\u5c11\u6587\u4ef6\u5b57\u6bb5 file' },
    })
  })
})
