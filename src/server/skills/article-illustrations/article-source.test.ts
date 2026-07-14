import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { ArticleSourceError, extractArticle } from './article-source'

const tempPaths: string[] = []
afterEach(() => { for (const tempPath of tempPaths.splice(0)) fs.rmSync(tempPath, { force: true }) })

describe('extractArticle', () => {
  it('normalizes pasted text and enforces the content cap', async () => {
    await expect(extractArticle({ type: 'text', text: '  Hello\n\n\n  world  ', title: 'Draft' })).resolves.toMatchObject({
      title: 'Draft', text: 'Hello\n\nworld', sourceType: 'text', sourceLabel: 'Draft',
    })
    await expect(extractArticle({ type: 'text', text: 'x'.repeat(100_001) })).rejects.toMatchObject({ code: 'ARTICLE_TEXT_TOO_LONG' })
  })

  it('requires consent and rejects non-public URL sources before fetching', async () => {
    await expect(extractArticle({ type: 'url', url: 'https://example.test/a', consent: false })).rejects.toMatchObject({ code: 'URL_CONSENT_REQUIRED' })
    await expect(extractArticle({ type: 'url', url: 'file:///etc/passwd', consent: true })).rejects.toMatchObject({ code: 'URL_NOT_ALLOWED' })
    await expect(extractArticle({ type: 'url', url: 'http://127.0.0.1/a', consent: true })).rejects.toMatchObject({ code: 'URL_NOT_ALLOWED' })
    await expect(extractArticle({ type: 'url', url: 'http://169.254.169.254/latest', consent: true })).rejects.toMatchObject({ code: 'URL_NOT_ALLOWED' })
  })

  it('extracts safe HTML and provides a typed fetch failure for paste fallback', async () => {
    const fetchImpl = async () => new Response('<html><head><title>Article title</title><style>hide</style></head><body><script>bad()</script><h1>Hello</h1><p>article content</p></body></html>', { headers: { 'content-type': 'text/html' } })
    await expect(extractArticle({ type: 'url', url: 'https://example.test/article', consent: true }, {
      fetchImpl, lookup: async () => ['93.184.216.34'],
    })).resolves.toMatchObject({ title: 'Article title', text: 'Hello article content', sourceType: 'url' })

    await expect(extractArticle({ type: 'url', url: 'https://example.test/article', consent: true }, {
      fetchImpl: async () => { throw new Error('offline') }, lookup: async () => ['93.184.216.34'],
    })).rejects.toMatchObject({ code: 'ARTICLE_FETCH_FAILED' } satisfies Partial<ArticleSourceError>)
  })

  it('extracts text documents and rejects unsupported files', async () => {
    const filePath = path.join(os.tmpdir(), `bloomai-article-${Date.now()}.md`)
    tempPaths.push(filePath)
    fs.writeFileSync(filePath, '# Heading\n\nDocument article')
    await expect(extractArticle({ type: 'file', filePath, fileName: 'article.md' })).resolves.toMatchObject({
      sourceType: 'file', sourceLabel: 'article.md', text: '# Heading\n\nDocument article',
    })
    await expect(extractArticle({ type: 'file', filePath, fileName: 'article.exe' })).rejects.toMatchObject({ code: 'UNSUPPORTED_ARTICLE_FILE' })
  })
})