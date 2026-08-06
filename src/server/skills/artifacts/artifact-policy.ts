import path from 'node:path'

export type ArtifactKind = 'markdown' | 'json' | 'prompt' | 'image-reference' | 'directory-manifest'

export type ArtifactDefinition = {
  readonly extension: string
  readonly mimeType: string
}

export const artifactDefinitions: Record<ArtifactKind, ArtifactDefinition> = {
  markdown: { extension: '.md', mimeType: 'text/markdown' },
  json: { extension: '.json', mimeType: 'application/json' },
  prompt: { extension: '.txt', mimeType: 'text/plain' },
  'image-reference': { extension: '.json', mimeType: 'application/vnd.bloomai.image-reference+json' },
  'directory-manifest': { extension: '.json', mimeType: 'application/vnd.bloomai.directory-manifest+json' },
}

export const ARTIFACT_MAX_METADATA_BYTES = 64 * 1024
export const ARTIFACT_MAX_FILE_NAME_BYTES = 255
export const ARTIFACT_CONTENT_PREVIEW_BYTES = 512

export class ArtifactPolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArtifactPolicyError'
  }
}

export function validateArtifactInput(input: {
  kind: ArtifactKind
  fileName: string
  content: Buffer
  metadata?: Record<string, unknown>
  maxContentBytes?: number
}): { fileName: string; mimeType: string; metadata: Record<string, unknown> } {
  const definition = artifactDefinitions[input.kind]
  if (!definition) throw new ArtifactPolicyError(`Unsupported artifact kind: ${input.kind}`)
  const fileName = validateArtifactFileName(input.fileName)
  if (path.extname(fileName).toLowerCase() !== definition.extension) {
    throw new ArtifactPolicyError(`${input.kind} artifacts must use a ${definition.extension} file name`)
  }
  const maxContentBytes = input.maxContentBytes ?? Number.MAX_SAFE_INTEGER
  if (!Number.isSafeInteger(maxContentBytes) || maxContentBytes < 1) {
    throw new ArtifactPolicyError('Artifact content budget must be a positive integer')
  }
  if (input.content.length > maxContentBytes) {
    throw new ArtifactPolicyError(`Artifact content exceeds the configured budget of ${maxContentBytes} bytes`)
  }

  const metadata = input.metadata ?? {}
  let serializedMetadata: string
  try {
    serializedMetadata = JSON.stringify(metadata)
  } catch {
    throw new ArtifactPolicyError('Artifact metadata must be JSON serializable')
  }
  if (Buffer.byteLength(serializedMetadata, 'utf8') > ARTIFACT_MAX_METADATA_BYTES) {
    throw new ArtifactPolicyError(`Artifact metadata exceeds the configured budget of ${ARTIFACT_MAX_METADATA_BYTES} bytes`)
  }
  return { fileName, mimeType: definition.mimeType, metadata }
}

export function validateArtifactFileName(value: string): string {
  if (!value || path.basename(value) !== value || path.isAbsolute(value) || value.includes('/') || value.includes('\\')) {
    throw new ArtifactPolicyError(`Unsafe artifact file name: ${value}`)
  }
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ArtifactPolicyError(`Unsafe artifact file name: ${value}`)
  }
  if (Buffer.byteLength(value, 'utf8') > ARTIFACT_MAX_FILE_NAME_BYTES) {
    throw new ArtifactPolicyError(`Artifact file name exceeds the configured budget of ${ARTIFACT_MAX_FILE_NAME_BYTES} bytes`)
  }
  return value
}

export function summarizeArtifactContent(content: Buffer, mimeType: string): string | null {
  if (!mimeType.startsWith('text/') && !mimeType.endsWith('+json') && mimeType !== 'application/json') return null
  const preview = content.subarray(0, ARTIFACT_CONTENT_PREVIEW_BYTES).toString('utf8')
  return content.length > ARTIFACT_CONTENT_PREVIEW_BYTES ? `${preview}…` : preview
}
