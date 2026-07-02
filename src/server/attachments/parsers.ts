import * as fs from 'fs'
import { PDFParse } from 'pdf-parse'
import mammoth from 'mammoth'

// Low-level document parsers shared by the attachment text extractor (bounded excerpt for the
// chat prompt) and the doc_* tools (structured on-demand deep read). Keeping the library calls
// in one place means PDF/DOCX handling has a single implementation.

export async function parsePdf(filePath: string): Promise<{ text: string; numPages: number }> {
  const data = new Uint8Array(fs.readFileSync(filePath))
  const parser = new PDFParse({ data })
  try {
    // pageJoiner: '' suppresses the default per-page "-- N of M --" marker so extracted text is clean.
    const res = await parser.getText({ pageJoiner: '' })
    return { text: res.text || '', numPages: res.total || 0 }
  } finally {
    await parser.destroy().catch(() => {})
  }
}

export async function parseDocx(
  filePath: string,
  format: 'text' | 'html' = 'text',
): Promise<{ text?: string; html?: string }> {
  if (format === 'html') {
    const { value } = await mammoth.convertToHtml({ path: filePath })
    return { html: value }
  }
  const { value } = await mammoth.extractRawText({ path: filePath })
  return { text: value }
}

export function readTextFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8')
}
