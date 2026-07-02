import { Hono } from 'hono'
import { logError, sanitizeErrorMessage } from '../../logger/logger'
import { AttachmentError, saveAttachment } from '../../attachments/attachment-service'
import { type Attachment } from '../../../shared/attachments'

/**
 * Chat attachment upload. Accepts multipart/form-data with one or more `file` fields, validates
 * type (MD/DOCX/PDF/TXT/CSV) and size (5MB each), stores under DATA_DIR_ATTACHMENT/<YYYYMMDD>/,
 * and returns the stored metadata (including the server path the chat route needs to extract text).
 */
export const attachmentsRoutes = new Hono()

attachmentsRoutes.post('/', async (c) => {
  let body: Record<string, unknown>
  try {
    body = await c.req.parseBody({ all: true })
  } catch {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: '无法解析上传内容' } }, 400)
  }

  // `all: true` yields an array when a field repeats; normalize `file` to a list either way.
  const raw = body['file']
  const files = (Array.isArray(raw) ? raw : [raw]).filter((f): f is File => f instanceof File)
  if (files.length === 0) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: '缺少文件字段 file' } }, 400)
  }

  const saved: Attachment[] = []
  try {
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer())
      saved.push(saveAttachment({ name: file.name, buffer }))
    }
  } catch (error) {
    if (error instanceof AttachmentError) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: error.message } }, 400)
    }
    logError('attachments.upload', { code: 'UPLOAD_ERROR', message: sanitizeErrorMessage(error, 'upload failed') })
    return c.json({ error: { code: 'UPLOAD_ERROR', message: '附件保存失败' } }, 500)
  }

  // The renderer keeps the full metadata (incl. path) in memory to send back on the next chat
  // turn; the path is only ever used server-side (validated against the attachment dir).
  return c.json({ data: saved }, 201)
})
