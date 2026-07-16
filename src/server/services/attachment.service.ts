import { type Attachment } from '../../shared/attachments'
import {
  AttachmentError,
  extractAttachmentText as extractStoredAttachmentText,
  saveAttachment,
} from '../attachments/attachment-service'
import { isServiceError, ServiceError } from './errors'

type AttachmentServiceDependencies = {
  saveAttachment: typeof saveAttachment
  extractAttachmentText: typeof extractStoredAttachmentText
}

export function createAttachmentService(overrides: Partial<AttachmentServiceDependencies> = {}) {
  const dependencies: AttachmentServiceDependencies = {
    saveAttachment,
    extractAttachmentText: extractStoredAttachmentText,
    ...overrides,
  }

  return {
    saveUploadedAttachment(input: { name: string; buffer: Buffer }): Attachment {
      try {
        return dependencies.saveAttachment(input)
      } catch (error) {
        if (isServiceError(error)) throw error
        if (error instanceof AttachmentError) {
          throw new ServiceError('VALIDATION_ERROR', error.message)
        }
        throw new ServiceError('UPLOAD_ERROR', '\u9644\u4ef6\u4fdd\u5b58\u5931\u8d25')
      }
    },

    extractAttachmentText(attachment: Pick<Attachment, 'name' | 'ext' | 'path'>): Promise<string> {
      return dependencies.extractAttachmentText(attachment)
    },
  }
}

export const attachmentService = createAttachmentService()
export const saveUploadedAttachment = attachmentService.saveUploadedAttachment
export const extractAttachmentText = attachmentService.extractAttachmentText
