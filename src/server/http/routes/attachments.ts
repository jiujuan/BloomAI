import { Hono } from 'hono'
import { type Attachment } from '../../../shared/attachments'
import { attachmentService } from '../../services/attachment.service'
import { ServiceError } from '../../services/errors'
import { mapErrorToHttpResponse } from '../error-mapper'

/**
 * Chat attachment upload. Parses multipart/form-data, delegates validation and
 * persistence to AttachmentService, then returns the stable stored metadata.
 */
export const attachmentsRoutes = new Hono()

attachmentsRoutes.post('/', async (c) => {
  let body: Record<string, unknown>
  try {
    body = await c.req.parseBody({ all: true })
  } catch {
    return attachmentError(c, new ServiceError('VALIDATION_ERROR', '\u65e0\u6cd5\u89e3\u6790\u4e0a\u4f20\u5185\u5bb9'))
  }

  // `all: true` yields an array when a field repeats; normalize `file` to a list either way.
  const raw = body.file
  const files = (Array.isArray(raw) ? raw : [raw]).filter((file): file is File => file instanceof File)
  if (files.length === 0) {
    return attachmentError(c, new ServiceError('VALIDATION_ERROR', '\u7f3a\u5c11\u6587\u4ef6\u5b57\u6bb5 file'))
  }

  const saved: Attachment[] = []
  try {
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer())
      saved.push(attachmentService.saveUploadedAttachment({ name: file.name, buffer }))
    }
  } catch (error) {
    return attachmentError(c, error instanceof ServiceError ? error : new ServiceError('UPLOAD_ERROR', '\u9644\u4ef6\u4fdd\u5b58\u5931\u8d25'))
  }

  // The renderer keeps this metadata in memory for the next chat turn. The path
  // remains server-side and is revalidated by the lower-level extractor.
  return c.json({ data: saved }, 201)
})

function attachmentError(c: any, error: unknown) {
  const response = mapErrorToHttpResponse(error)
  return c.json(response.body, response.status)
}
