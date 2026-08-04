import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export type ScreenshotArtifactInput = {
  bytes: Buffer
  mimeType: 'image/png' | 'image/jpeg'
  dataDir: string
  runId?: string
  maxBytes: number
}

export type ScreenshotArtifact = {
  imagePath: string
  bytes: number
  mimeType: ScreenshotArtifactInput['mimeType']
}

export async function writeScreenshotArtifact(input: ScreenshotArtifactInput): Promise<ScreenshotArtifact> {
  if (input.bytes.byteLength > input.maxBytes) {
    throw new Error(`Screenshot artifact exceeds the ${input.maxBytes}-byte limit`)
  }
  const runId = safeRunId(input.runId)
  const extension = input.mimeType === 'image/jpeg' ? 'jpg' : 'png'
  const directory = path.join(input.dataDir, 'tool-artifacts', 'web-screenshot', runId)
  const imagePath = path.join(directory, `screenshot.${extension}`)
  await fs.promises.mkdir(directory, { recursive: true })
  await fs.promises.writeFile(imagePath, input.bytes, { flag: 'wx' }).catch(async (error: unknown) => {
    if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error
    await fs.promises.writeFile(imagePath, input.bytes)
  })
  return { imagePath, bytes: input.bytes.byteLength, mimeType: input.mimeType }
}

function safeRunId(value: string | undefined): string {
  return value && /^[A-Za-z0-9._-]{1,128}$/.test(value) ? value : randomUUID()
}
