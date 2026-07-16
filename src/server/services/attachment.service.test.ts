import { describe, expect, it, vi } from 'vitest'
import { AttachmentError } from '../attachments/attachment-service'
import { createAttachmentService } from './attachment.service'

describe('AttachmentService', () => {
  it('maps upload validation failures into the shared ServiceError boundary', () => {
    const service = createAttachmentService({
      saveAttachment: vi.fn(() => { throw new AttachmentError('Unsupported attachment type') }),
    } as any)

    expect(() => service.saveUploadedAttachment({ name: 'unsafe.exe', buffer: Buffer.from('x') })).toThrow(expect.objectContaining({
      name: 'ServiceError',
      code: 'VALIDATION_ERROR',
      message: 'Unsupported attachment type',
    }))
  })

  it('delegates attachment text extraction for Chat service use', async () => {
    const extractAttachmentText = vi.fn(async () => 'attachment text')
    const service = createAttachmentService({ extractAttachmentText } as any)
    const attachment = { id: 'attachment-1', name: 'notes.txt', ext: 'txt', size: 4, path: 'C:/safe/notes.txt', uploadedAt: 1 }

    await expect(service.extractAttachmentText(attachment)).resolves.toBe('attachment text')
    expect(extractAttachmentText).toHaveBeenCalledWith(attachment)
  })
})
