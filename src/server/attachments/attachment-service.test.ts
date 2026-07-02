import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AttachmentError, extractAttachmentText, saveAttachment } from './attachment-service'

let baseDir: string
let originalEnv: NodeJS.ProcessEnv

describe('attachment-service', () => {
  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-attach-'))
    originalEnv = { ...process.env }
    process.env.DATA_DIR_ATTACHMENT = baseDir
  })

  afterEach(() => {
    process.env = originalEnv
    fs.rmSync(baseDir, { recursive: true, force: true })
  })

  it('stores a valid file under a YYYYMMDD subdir and returns metadata', () => {
    const att = saveAttachment({ name: 'notes.txt', buffer: Buffer.from('hello world') })
    expect(att.ext).toBe('txt')
    expect(att.size).toBe(11)
    expect(att.name).toBe('notes.txt')
    // path is <base>/<YYYYMMDD>/<uuid>-notes.txt and the file exists.
    expect(fs.existsSync(att.path)).toBe(true)
    const datedDir = path.basename(path.dirname(att.path))
    expect(datedDir).toMatch(/^\d{8}$/)
    expect(att.path.startsWith(baseDir)).toBe(true)
  })

  it('rejects unsupported types and oversize files', () => {
    expect(() => saveAttachment({ name: 'evil.exe', buffer: Buffer.from('x') })).toThrow(AttachmentError)
    const big = Buffer.alloc(5 * 1024 * 1024 + 1)
    expect(() => saveAttachment({ name: 'big.pdf', buffer: big })).toThrow(/5MB/)
  })

  it('extracts text from a stored text file', async () => {
    const att = saveAttachment({ name: 'a.md', buffer: Buffer.from('# Title\nbody') })
    const text = await extractAttachmentText(att)
    expect(text).toContain('Title')
    expect(text).toContain('body')
  })

  it('refuses to read a path outside the attachment dir (traversal guard)', async () => {
    const outside = path.join(os.tmpdir(), 'not-an-attachment.txt')
    fs.writeFileSync(outside, 'secret')
    const text = await extractAttachmentText({ name: 'x.txt', ext: 'txt', path: outside })
    expect(text).toContain('不可读取')
    fs.rmSync(outside, { force: true })
  })
})
